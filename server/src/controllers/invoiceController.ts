import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { checkPeriodLocked } from './financialYearController';
import { generateInvoicePDF } from '../utils/pdfGenerator';

// Helper function to calculate GST split
const calculateGSTSplit = (amount: number, taxRate: number, isInterState: boolean) => {
    if (isInterState) {
        return {
            cgst_rate: 0,
            cgst_amount: 0,
            sgst_rate: 0,
            sgst_amount: 0,
            igst_rate: taxRate,
            igst_amount: (amount * taxRate) / 100
        };
    } else {
        const halfRate = taxRate / 2;
        const halfAmount = (amount * halfRate) / 100;
        return {
            cgst_rate: halfRate,
            cgst_amount: halfAmount,
            sgst_rate: halfRate,
            sgst_amount: halfAmount,
            igst_rate: 0,
            igst_amount: 0
        };
    }
};

export const createInvoiceService = async (invoiceData: any) => {
    const {
        companyId, partyLedgerId, salesLedgerId,
        invoiceNumber, date, dueDate, type,
        items, notes, discountPercent = 0
    } = invoiceData;

    // 1. Get company and party states for GST calculation
    const companyRes = await query('SELECT state FROM companies WHERE id = $1', [companyId]);
    const partyRes = await query('SELECT state FROM ledgers WHERE id = $1', [partyLedgerId]);

    const companyState = companyRes.rows[0]?.state || '';
    const partyState = partyRes.rows[0]?.state || '';
    // Only inter-state if BOTH states are set AND they are different
    const isInterState = companyState && partyState && companyState !== partyState;

    // 2. Calculate totals with GST split
    let subtotal = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    let totalIGST = 0;
    const invoiceItemsData = [];

    for (const item of items) {
        const amount = Number(item.quantity) * Number(item.rate);
        const itemDiscountPercent = Number(item.discountPercent || 0);
        const discountAmount = (amount * itemDiscountPercent) / 100;
        const taxableAmount = amount - discountAmount;

        const gst = calculateGSTSplit(taxableAmount, Number(item.taxRate), isInterState);
        const totalTax = gst.cgst_amount + gst.sgst_amount + gst.igst_amount;
        const itemTotal = taxableAmount + totalTax;

        subtotal += taxableAmount;
        totalCGST += gst.cgst_amount;
        totalSGST += gst.sgst_amount;
        totalIGST += gst.igst_amount;

        invoiceItemsData.push({
            ...item,
            amount,
            discount_percent: itemDiscountPercent,
            discount_amount: discountAmount,
            taxable_amount: taxableAmount,
            ...gst,
            total_amount: itemTotal
        });
    }

    const invoiceDiscountAmount = (subtotal * Number(discountPercent)) / 100;
    const totalTax = totalCGST + totalSGST + totalIGST;
    const grandTotal = subtotal + totalTax - invoiceDiscountAmount;

    // 3. Create Voucher
    // Get voucher type ID for Sales/Purchase
    const voucherTypeName =
        type === 'SALES' ? 'Sales' :
            type === 'PURCHASE' ? 'Purchase' :
                type === 'CREDIT_NOTE' ? 'Credit Note' :
                    'Debit Note';

    const voucherTypeRes = await query(
        `SELECT id FROM voucher_types WHERE company_id = $1 AND name = $2`,
        [companyId, voucherTypeName]
    );

    let voucherTypeId;
    if (voucherTypeRes.rows.length > 0) {
        voucherTypeId = voucherTypeRes.rows[0].id;
    } else {
        // Create if not exists
        const newVoucherType = await query(
            `INSERT INTO voucher_types (company_id, name, type) VALUES ($1, $2, $3) RETURNING id`,
            [companyId, voucherTypeName, voucherTypeName] // Simplified type mapping
        );
        voucherTypeId = newVoucherType.rows[0].id;
    }

    const voucherRes = await query(
        `INSERT INTO vouchers (company_id, voucher_type_id, voucher_number, date, narration, total_amount)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [companyId, voucherTypeId, invoiceNumber, date, `Invoice #${invoiceNumber} - ${notes || ''}`, grandTotal]
    );
    const voucherId = voucherRes.rows[0].id;

    // Create Voucher Entries
    // Determine Dr/Cr based on type
    // SALES: Party Dr, Sales Cr
    // PURCHASE: Party Cr, Purchase Dr
    // CREDIT_NOTE (Sales Return): Party Cr, Sales Return Dr
    // DEBIT_NOTE (Purchase Return): Party Dr, Purchase Return Cr

    let partyEntryType = 'Dr';
    let accountEntryType = 'Cr';

    if (type === 'SALES') {
        partyEntryType = 'Dr';
        accountEntryType = 'Cr';
    } else if (type === 'PURCHASE') {
        partyEntryType = 'Cr';
        accountEntryType = 'Dr';
    } else if (type === 'CREDIT_NOTE') {
        partyEntryType = 'Cr';
        accountEntryType = 'Dr';
    } else if (type === 'DEBIT_NOTE') {
        partyEntryType = 'Dr';
        accountEntryType = 'Cr';
    }

    // Party Entry
    await query(
        `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
        [voucherId, partyLedgerId, grandTotal, partyEntryType]
    );

    // Sales/Purchase/Return Account Entry
    await query(
        `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
        [voucherId, salesLedgerId, subtotal - invoiceDiscountAmount, accountEntryType]
    );

    // Tax Entries: Follow Account Entry Type (Output Tax follows Sales, Input Tax follows Purchase)
    // For CN (Sales Return), Output Tax is reversed (Dr).
    // For DN (Purchase Return), Input Tax is reversed (Cr).
    // So Tax Entry Type = Account Entry Type.
    const taxEntryType = accountEntryType;

    if (isInterState && totalIGST > 0) {
        const igstLedger = await query(
            `SELECT id FROM ledgers WHERE company_id = $1 AND name ILIKE '%IGST%' LIMIT 1`,
            [companyId]
        );
        if (igstLedger.rows.length > 0) {
            await query(
                `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
                [voucherId, igstLedger.rows[0].id, totalIGST, taxEntryType]
            );
        }
    } else {
        // CGST
        if (totalCGST > 0) {
            const cgstLedger = await query(
                `SELECT id FROM ledgers WHERE company_id = $1 AND name ILIKE '%CGST%' LIMIT 1`,
                [companyId]
            );
            if (cgstLedger.rows.length > 0) {
                await query(
                    `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
                    [voucherId, cgstLedger.rows[0].id, totalCGST, taxEntryType]
                );
            }
        }

        // SGST
        if (totalSGST > 0) {
            const sgstLedger = await query(
                `SELECT id FROM ledgers WHERE company_id = $1 AND name ILIKE '%SGST%' LIMIT 1`,
                [companyId]
            );
            if (sgstLedger.rows.length > 0) {
                await query(
                    `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
                    [voucherId, sgstLedger.rows[0].id, totalSGST, taxEntryType]
                );
            }
        }
    }


    let original_invoice_date = invoiceData.originalInvoiceDate || null;

    // 4. Create Invoice
    const invoiceRes = await query(
        `INSERT INTO invoices (
            company_id, voucher_id, party_ledger_id, sales_ledger_id, 
            invoice_number, date, due_date, type, 
            subtotal, tax_total, grand_total, notes,
            discount_percent, discount_amount, outstanding_amount, payment_status,
            original_invoice_number, original_invoice_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
        [companyId, voucherId, partyLedgerId, salesLedgerId, invoiceNumber, date, dueDate, type,
            subtotal, totalTax, grandTotal, notes, discountPercent, invoiceDiscountAmount, grandTotal, 'UNPAID',
            invoiceData.originalInvoiceNumber, original_invoice_date]
    );
    const invoice = invoiceRes.rows[0];

    // 5. Create Invoice Items & Update Inventory
    for (const item of invoiceItemsData) {
        await query(
            `INSERT INTO invoice_items (
                invoice_id, item_id, description, quantity, 
                rate, amount, discount_percent, discount_amount, taxable_amount,
                tax_rate, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_amount
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [invoice.id, item.itemId, item.description, item.quantity, item.rate, item.amount,
            item.discount_percent, item.discount_amount, item.taxable_amount,
            item.taxRate, item.cgst_rate, item.cgst_amount, item.sgst_rate, item.sgst_amount,
            item.igst_rate, item.igst_amount, item.total_amount]
        );

        // Update Inventory Quantity
        if (item.itemId) {
            let qtyChange = 0;
            // SALES: Decrease Inventory
            // PURCHASE: Increase Inventory
            // CREDIT_NOTE (Sales Return): Increase Inventory
            // DEBIT_NOTE (Purchase Return): Decrease Inventory

            if (type === 'SALES') qtyChange = -Number(item.quantity);
            else if (type === 'PURCHASE') qtyChange = Number(item.quantity);
            else if (type === 'CREDIT_NOTE') qtyChange = Number(item.quantity);
            else if (type === 'DEBIT_NOTE') qtyChange = -Number(item.quantity);

            await query(
                `UPDATE items SET current_quantity = current_quantity + $1 WHERE id = $2`,
                [qtyChange, item.itemId]
            );
        }
    }

    return invoice;
};

export const createInvoice = async (req: Request, res: Response, next: NextFunction) => {
    const {
        companyId, partyLedgerId, salesLedgerId,
        invoiceNumber, date, dueDate, type,
        items, notes, discountPercent = 0
    } = req.body;

    if (!items || items.length === 0) {
        return next(new AppError('Invoice must have items', 400));
    }

    try {
        // Check period lock
        const isLocked = await checkPeriodLocked(companyId, date);
        if (isLocked) {
            return next(new AppError('Cannot create invoice in a closed financial period', 400));
        }

        await query('BEGIN');

        const invoice = await createInvoiceService(req.body);

        await query('COMMIT');
        res.status(201).json({ status: 'success', data: { invoice } });

    } catch (error) {
        await query('ROLLBACK');
        next(error);
    }
};

export const getInvoices = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, type, paymentStatus } = req.query;

    try {
        let queryStr = `
            SELECT i.*, l.name as party_name 
            FROM invoices i 
            LEFT JOIN ledgers l ON i.party_ledger_id = l.id 
            WHERE i.company_id = $1 AND i.type = $2
        `;
        const params: any[] = [companyId, type];

        if (paymentStatus) {
            queryStr += ' AND i.payment_status = $3';
            params.push(paymentStatus);
        }

        queryStr += ' ORDER BY i.date DESC';

        const result = await query(queryStr, params);
        res.status(200).json({ status: 'success', data: { invoices: result.rows } });
    } catch (error) {
        next(error);
    }
};

export const getInvoiceById = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        const invoiceRes = await query(
            `SELECT i.*, l.name as party_name, l.gstin as party_gstin, l.state as party_state,
                    sl.name as sales_ledger_name, c.name as company_name, c.gstin as company_gstin, c.state as company_state,
                    i.original_invoice_number, i.original_invoice_date
             FROM invoices i 
             LEFT JOIN ledgers l ON i.party_ledger_id = l.id 
             LEFT JOIN ledgers sl ON i.sales_ledger_id = sl.id
             LEFT JOIN companies c ON i.company_id = c.id
             WHERE i.id = $1`,
            [id]
        );

        if (invoiceRes.rows.length === 0) {
            return next(new AppError('Invoice not found', 404));
        }

        const itemsRes = await query(
            `SELECT ii.*, it.name as item_name, it.hsn_code, u.symbol as unit_symbol 
             FROM invoice_items ii 
             LEFT JOIN items it ON ii.item_id = it.id 
             LEFT JOIN units u ON it.unit_id = u.id
             WHERE ii.invoice_id = $1`,
            [id]
        );

        const paymentsRes = await query(
            `SELECT * FROM payments WHERE invoice_id = $1 ORDER BY payment_date DESC`,
            [id]
        );

        res.status(200).json({
            status: 'success',
            data: {
                invoice: invoiceRes.rows[0],
                items: itemsRes.rows,
                payments: paymentsRes.rows
            }
        });
    } catch (error) {
        next(error);
    }
};

export const deleteInvoice = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        await query('BEGIN');

        // Check if invoice has payments
        const paymentsCheck = await query(
            'SELECT COUNT(*) FROM payments WHERE invoice_id = $1',
            [id]
        );

        if (parseInt(paymentsCheck.rows[0].count) > 0) {
            return next(new AppError('Cannot delete invoice with payments. Please delete payments first.', 400));
        }

        // Get invoice details
        const invoiceRes = await query('SELECT * FROM invoices WHERE id = $1', [id]);
        if (invoiceRes.rows.length === 0) {
            return next(new AppError('Invoice not found', 404));
        }

        const invoice = invoiceRes.rows[0];

        // Get invoice items to reverse inventory
        const itemsRes = await query('SELECT * FROM invoice_items WHERE invoice_id = $1', [id]);

        // Reverse inventory quantities
        for (const item of itemsRes.rows) {
            // Update Inventory Quantity
            if (item.item_id) {
                let qtyChange = 0;
                // SALES: Decrease -> Reverse: Increase
                // PURCHASE: Increase -> Reverse: Decrease
                // CREDIT_NOTE (Sales Return): Increase -> Reverse: Decrease
                // DEBIT_NOTE (Purchase Return): Decrease -> Reverse: Increase

                if (invoice.type === 'SALES') qtyChange = Number(item.quantity); // Increase
                else if (invoice.type === 'PURCHASE') qtyChange = -Number(item.quantity); // Decrease
                else if (invoice.type === 'CREDIT_NOTE') qtyChange = -Number(item.quantity); // Decrease
                else if (invoice.type === 'DEBIT_NOTE') qtyChange = Number(item.quantity); // Increase

                await query(
                    `UPDATE items SET current_quantity = current_quantity + $1 WHERE id = $2`,
                    [qtyChange, item.item_id]
                );
            }
        }

        // Delete invoice items
        await query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);

        // Delete voucher entries
        if (invoice.voucher_id) {
            await query('DELETE FROM voucher_entries WHERE voucher_id = $1', [invoice.voucher_id]);
            await query('DELETE FROM vouchers WHERE id = $1', [invoice.voucher_id]);
        }

        // Delete invoice
        await query('DELETE FROM invoices WHERE id = $1', [id]);

        await query('COMMIT');
        res.status(204).json({ status: 'success', data: null });
    } catch (error) {
        await query('ROLLBACK');
        next(error);
    }
};

export const updateInvoice = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const {
        partyLedgerId, salesLedgerId,
        invoiceNumber, date, dueDate, type,
        items, notes, discountPercent = 0
    } = req.body;

    if (!items || items.length === 0) {
        return next(new AppError('Invoice must have items', 400));
    }

    try {
        await query('BEGIN');

        // Get existing invoice
        const existingInvoiceRes = await query('SELECT * FROM invoices WHERE id = $1', [id]);
        if (existingInvoiceRes.rows.length === 0) {
            return next(new AppError('Invoice not found', 404));
        }

        const existingInvoice = existingInvoiceRes.rows[0];

        // Check if invoice has payments
        const paymentsCheck = await query(
            'SELECT COUNT(*) FROM payments WHERE invoice_id = $1',
            [id]
        );
        if (parseInt(paymentsCheck.rows[0].count) > 0) {
            return next(new AppError('Cannot edit invoice with payments. Please delete payments first.', 400));
        }

        // Check period lock for both old and new dates
        const isOldDateLocked = await checkPeriodLocked(existingInvoice.company_id, existingInvoice.date);
        const isNewDateLocked = await checkPeriodLocked(existingInvoice.company_id, date);

        if (isOldDateLocked || isNewDateLocked) {
            return next(new AppError('Cannot edit invoice in a closed financial period', 400));
        }

        // REVERSAL PHASE
        // 1. Get old invoice items to reverse inventory
        const oldItemsRes = await query('SELECT * FROM invoice_items WHERE invoice_id = $1', [id]);
        for (const oldItem of oldItemsRes.rows) {
            if (oldItem.item_id) {
                let qtyChange = 0;
                // REVERSE operation: 
                // SALES (Decrease) -> Increase
                // PURCHASE (Increase) -> Decrease
                // CREDIT_NOTE (Increase) -> Decrease
                // DEBIT_NOTE (Decrease) -> Increase

                if (existingInvoice.type === 'SALES') qtyChange = Number(oldItem.quantity);
                else if (existingInvoice.type === 'PURCHASE') qtyChange = -Number(oldItem.quantity);
                else if (existingInvoice.type === 'CREDIT_NOTE') qtyChange = -Number(oldItem.quantity);
                else if (existingInvoice.type === 'DEBIT_NOTE') qtyChange = Number(oldItem.quantity);

                await query(
                    'UPDATE items SET current_quantity = current_quantity + $1 WHERE id = $2',
                    [qtyChange, oldItem.item_id]
                );
            }
        }

        // 2. Delete old invoice items
        await query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);

        // 3. Delete old voucher entries
        if (existingInvoice.voucher_id) {
            await query('DELETE FROM voucher_entries WHERE voucher_id = $1', [existingInvoice.voucher_id]);
        }

        // RE-CREATION PHASE
        // Get company and party states for GST calculation
        const companyRes = await query('SELECT state FROM companies WHERE id = $1', [existingInvoice.company_id]);
        const partyRes = await query('SELECT state FROM ledgers WHERE id = $1', [partyLedgerId]);

        const companyState = companyRes.rows[0]?.state || '';
        const partyState = partyRes.rows[0]?.state || '';
        // Only inter-state if BOTH states are set AND they are different
        const isInterState = companyState && partyState && companyState !== partyState;

        // Calculate totals with GST split
        let subtotal = 0;
        let totalCGST = 0;
        let totalSGST = 0;
        let totalIGST = 0;
        const invoiceItemsData = [];

        for (const item of items) {
            const amount = Number(item.quantity) * Number(item.rate);
            const itemDiscountPercent = Number(item.discountPercent || 0);
            const discountAmount = (amount * itemDiscountPercent) / 100;
            const taxableAmount = amount - discountAmount;

            const gst = calculateGSTSplit(taxableAmount, Number(item.taxRate), isInterState);
            const totalTax = gst.cgst_amount + gst.sgst_amount + gst.igst_amount;
            const itemTotal = taxableAmount + totalTax;

            subtotal += taxableAmount;
            totalCGST += gst.cgst_amount;
            totalSGST += gst.sgst_amount;
            totalIGST += gst.igst_amount;

            invoiceItemsData.push({
                ...item,
                amount,
                discount_percent: itemDiscountPercent,
                discount_amount: discountAmount,
                taxable_amount: taxableAmount,
                ...gst,
                total_amount: itemTotal
            });
        }

        const invoiceDiscountAmount = (subtotal * Number(discountPercent)) / 100;
        const totalTax = totalCGST + totalSGST + totalIGST;
        const grandTotal = subtotal + totalTax - invoiceDiscountAmount;

        // Update voucher
        if (existingInvoice.voucher_id) {
            await query(
                `UPDATE vouchers SET voucher_number = $1, date = $2, narration = $3, total_amount = $4 WHERE id = $5`,
                [invoiceNumber, date, `Invoice #${invoiceNumber} - ${notes || ''}`, grandTotal, existingInvoice.voucher_id]
            );
        }

        // Create new voucher entries
        const voucherId = existingInvoice.voucher_id;

        // Determine Dr/Cr based on type
        let partyEntryType = 'Dr';
        let accountEntryType = 'Cr';

        if (type === 'SALES') {
            partyEntryType = 'Dr';
            accountEntryType = 'Cr';
        } else if (type === 'PURCHASE') {
            partyEntryType = 'Cr';
            accountEntryType = 'Dr';
        } else if (type === 'CREDIT_NOTE') {
            partyEntryType = 'Cr';
            accountEntryType = 'Dr';
        } else if (type === 'DEBIT_NOTE') {
            partyEntryType = 'Dr';
            accountEntryType = 'Cr';
        }

        // Party Entry
        await query(
            `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
            [voucherId, partyLedgerId, grandTotal, partyEntryType]
        );

        // Sales/Purchase Account Entry
        await query(
            `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
            [voucherId, salesLedgerId, subtotal - invoiceDiscountAmount, accountEntryType]
        );

        // Tax Entries
        const taxEntryType = accountEntryType;

        if (isInterState && totalIGST > 0) {
            const igstLedger = await query(
                `SELECT id FROM ledgers WHERE company_id = $1 AND name ILIKE '%IGST%' LIMIT 1`,
                [existingInvoice.company_id]
            );
            if (igstLedger.rows.length > 0) {
                await query(
                    `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
                    [voucherId, igstLedger.rows[0].id, totalIGST, taxEntryType]
                );
            }
        } else {
            if (totalCGST > 0) {
                const cgstLedger = await query(
                    `SELECT id FROM ledgers WHERE company_id = $1 AND name ILIKE '%CGST%' LIMIT 1`,
                    [existingInvoice.company_id]
                );
                if (cgstLedger.rows.length > 0) {
                    await query(
                        `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
                        [voucherId, cgstLedger.rows[0].id, totalCGST, taxEntryType]
                    );
                }
            }

            if (totalSGST > 0) {
                const sgstLedger = await query(
                    `SELECT id FROM ledgers WHERE company_id = $1 AND name ILIKE '%SGST%' LIMIT 1`,
                    [existingInvoice.company_id]
                );
                if (sgstLedger.rows.length > 0) {
                    await query(
                        `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
                        [voucherId, sgstLedger.rows[0].id, totalSGST, taxEntryType]
                    );
                }
            }
        }

        // Update invoice header
        await query(
            `UPDATE invoices SET 
                party_ledger_id = $1, sales_ledger_id = $2, invoice_number = $3, 
                date = $4, due_date = $5, type = $6, subtotal = $7, tax_total = $8, 
                grand_total = $9, notes = $10, discount_percent = $11, discount_amount = $12,
                outstanding_amount = $13,
                original_invoice_number = $14, original_invoice_date = $15
             WHERE id = $16`,
            [partyLedgerId, salesLedgerId, invoiceNumber, date, dueDate, type,
                subtotal, totalTax, grandTotal, notes, discountPercent, invoiceDiscountAmount, grandTotal,
                req.body.originalInvoiceNumber, req.body.originalInvoiceDate, id]
        );

        // Create new invoice items & Update inventory
        for (const item of invoiceItemsData) {
            await query(
                `INSERT INTO invoice_items (
                    invoice_id, item_id, description, quantity, 
                    rate, amount, discount_percent, discount_amount, taxable_amount,
                    tax_rate, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_amount
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
                [id, item.itemId, item.description, item.quantity, item.rate, item.amount,
                    item.discount_percent, item.discount_amount, item.taxable_amount,
                    item.taxRate, item.cgst_rate, item.cgst_amount, item.sgst_rate, item.sgst_amount,
                    item.igst_rate, item.igst_amount, item.total_amount]
            );

            // Update Inventory Quantity
            if (item.itemId) {
                let qtyChange = 0;
                // SALES: Decrease
                // PURCHASE: Increase
                // CREDIT_NOTE (Sales Return): Increase
                // DEBIT_NOTE (Purchase Return): Decrease

                if (type === 'SALES') qtyChange = -Number(item.quantity);
                else if (type === 'PURCHASE') qtyChange = Number(item.quantity);
                else if (type === 'CREDIT_NOTE') qtyChange = Number(item.quantity);
                else if (type === 'DEBIT_NOTE') qtyChange = -Number(item.quantity);

                await query(
                    `UPDATE items SET current_quantity = current_quantity + $1 WHERE id = $2`,
                    [qtyChange, item.itemId]
                );
            }
        }

        await query('COMMIT');

        const updatedInvoice = await query('SELECT * FROM invoices WHERE id = $1', [id]);
        res.status(200).json({ status: 'success', data: { invoice: updatedInvoice.rows[0] } });

    } catch (error) {
        await query('ROLLBACK');
        next(error);
    }
};

export const downloadInvoicePDF = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        const doc = await generateInvoicePDF(id);

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice-${id}.pdf`);

        // Pipe the PDF to the response
        doc.pipe(res);
        doc.end();
    } catch (error) {
        next(error);
    }
};

export const sendInvoiceEmail = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { to, cc, subject, message } = req.body;

    try {
        // Get invoice details
        const invoiceRes = await query(
            `SELECT i.*, l.email as party_email, l.name as party_name 
             FROM invoices i 
             LEFT JOIN ledgers l ON i.party_ledger_id = l.id 
             WHERE i.id = $1`,
            [id]
        );

        if (invoiceRes.rows.length === 0) {
            return next(new AppError('Invoice not found', 404));
        }

        const invoice = invoiceRes.rows[0];
        const recipient = to || invoice.party_email;

        if (!recipient) {
            return next(new AppError('No recipient email address provided', 400));
        }

        // Generate PDF
        const doc = await generateInvoicePDF(id);
        const chunks: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', async () => {
            const pdfBuffer = Buffer.concat(chunks);

            // Import nodemailer dynamically
            const nodemailer = await import('nodemailer');

            // Create transporter
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: Number(process.env.SMTP_PORT) || 587,
                secure: process.env.SMTP_PORT === '465',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASSWORD
                }
            });

            // Send email
            const mailOptions = {
                from: process.env.SMTP_USER,
                to: recipient,
                cc: cc || undefined,
                subject: subject || `Invoice #${invoice.invoice_number}`,
                text: message || `Please find attached invoice #${invoice.invoice_number}.`,
                html: `
                    <p>Dear ${invoice.party_name},</p>
                    <p>${message || `Please find attached invoice #${invoice.invoice_number}.`}</p>
                    <p>Invoice Details:</p>
                    <ul>
                        <li>Invoice Number: ${invoice.invoice_number}</li>
                        <li>Date: ${new Date(invoice.date).toLocaleDateString()}</li>
                        <li>Amount: ₹${Number(invoice.grand_total).toFixed(2)}</li>
                    </ul>
                    <p>Thank you for your business!</p>
                `,
                attachments: [
                    {
                        filename: `invoice-${invoice.invoice_number}.pdf`,
                        content: pdfBuffer
                    }
                ]
            };

            try {
                await transporter.sendMail(mailOptions);

                // Log email
                await query(
                    `INSERT INTO email_logs (invoice_id, recipient, cc, subject, status) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [id, recipient, cc || null, mailOptions.subject, 'SENT']
                );

                res.status(200).json({
                    status: 'success',
                    message: 'Email sent successfully',
                    data: { recipient, subject: mailOptions.subject }
                });
            } catch (emailError: any) {
                // Log failed email
                await query(
                    `INSERT INTO email_logs (invoice_id, recipient, cc, subject, status) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [id, recipient, cc || null, mailOptions.subject, 'FAILED']
                );

                return next(new AppError(`Failed to send email: ${emailError.message}`, 500));
            }
        });

        doc.end();

    } catch (error) {
        next(error);
    }
};
