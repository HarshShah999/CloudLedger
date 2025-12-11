import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

export const createPayment = async (req: Request, res: Response, next: NextFunction) => {
    const {
        companyId, invoiceId, paymentDate, amount,
        paymentMode, referenceNumber, notes
    } = req.body;

    try {
        await query('BEGIN');

        // Get invoice details
        const invoiceRes = await query(
            'SELECT * FROM invoices WHERE id = $1 AND company_id = $2',
            [invoiceId, companyId]
        );

        if (invoiceRes.rows.length === 0) {
            return next(new AppError('Invoice not found', 404));
        }

        const invoice = invoiceRes.rows[0];
        const newPaidAmount = Number(invoice.paid_amount) + Number(amount);

        if (newPaidAmount > Number(invoice.grand_total)) {
            return next(new AppError('Payment amount exceeds invoice total', 400));
        }

        // Create voucher for payment (Receipt for Sales, Payment for Purchase)
        const voucherTypeName = invoice.type === 'SALES' ? 'Receipt' : 'Payment';
        const voucherTypeRes = await query(
            'SELECT id FROM voucher_types WHERE company_id = $1 AND name = $2',
            [companyId, voucherTypeName]
        );

        let voucherId = null;
        if (voucherTypeRes.rows.length > 0) {
            const voucherRes = await query(
                `INSERT INTO vouchers (company_id, voucher_type_id, voucher_number, date, narration, total_amount) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [companyId, voucherTypeRes.rows[0].id, `PAY-${Date.now()}`, paymentDate,
                    `Payment for Invoice #${invoice.invoice_number}`, amount]
            );
            voucherId = voucherRes.rows[0].id;

            // Create voucher entries
            // Bank/Cash Dr (for Sales) or Cr (for Purchase)
            // Party Cr (for Sales) or Dr (for Purchase)
            const bankLedger = await query(
                `SELECT id FROM ledgers WHERE company_id = $1 AND name ILIKE '%${paymentMode || 'Cash'}%' LIMIT 1`,
                [companyId]
            );

            if (bankLedger.rows.length > 0) {
                await query(
                    `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
                    [voucherId, bankLedger.rows[0].id, amount, invoice.type === 'SALES' ? 'Dr' : 'Cr']
                );
            }

            await query(
                `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)`,
                [voucherId, invoice.party_ledger_id, amount, invoice.type === 'SALES' ? 'Cr' : 'Dr']
            );
        }

        // Create payment record
        const paymentRes = await query(
            `INSERT INTO payments (
                company_id, invoice_id, voucher_id, payment_date, amount,
                payment_mode, reference_number, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [companyId, invoiceId, voucherId, paymentDate, amount, paymentMode, referenceNumber, notes]
        );

        // Update invoice payment status
        const newOutstanding = Number(invoice.grand_total) - newPaidAmount;
        let paymentStatus = 'UNPAID';
        if (newPaidAmount >= Number(invoice.grand_total)) {
            paymentStatus = 'PAID';
        } else if (newPaidAmount > 0) {
            paymentStatus = 'PARTIAL';
        }

        await query(
            `UPDATE invoices SET paid_amount = $1, outstanding_amount = $2, payment_status = $3 WHERE id = $4`,
            [newPaidAmount, newOutstanding, paymentStatus, invoiceId]
        );

        await query('COMMIT');
        res.status(201).json({ status: 'success', data: { payment: paymentRes.rows[0] } });

    } catch (error) {
        await query('ROLLBACK');
        next(error);
    }
};

export const getPayments = async (req: Request, res: Response, next: NextFunction) => {
    const { invoiceId, companyId } = req.query;

    try {
        let queryStr = 'SELECT * FROM payments WHERE 1=1';
        const params: any[] = [];
        let paramCount = 1;

        if (invoiceId) {
            queryStr += ` AND invoice_id = $${paramCount}`;
            params.push(invoiceId);
            paramCount++;
        }

        if (companyId) {
            queryStr += ` AND company_id = $${paramCount}`;
            params.push(companyId);
            paramCount++;
        }

        queryStr += ' ORDER BY payment_date DESC';

        const result = await query(queryStr, params);
        res.status(200).json({ status: 'success', data: { payments: result.rows } });
    } catch (error) {
        next(error);
    }
};

export const deletePayment = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        await query('BEGIN');

        // Get payment details
        const paymentRes = await query('SELECT * FROM payments WHERE id = $1', [id]);
        if (paymentRes.rows.length === 0) {
            return next(new AppError('Payment not found', 404));
        }

        const payment = paymentRes.rows[0];

        // Get invoice
        const invoiceRes = await query('SELECT * FROM invoices WHERE id = $1', [payment.invoice_id]);
        const invoice = invoiceRes.rows[0];

        // Update invoice payment status
        const newPaidAmount = Number(invoice.paid_amount) - Number(payment.amount);
        const newOutstanding = Number(invoice.grand_total) - newPaidAmount;
        let paymentStatus = 'UNPAID';
        if (newPaidAmount >= Number(invoice.grand_total)) {
            paymentStatus = 'PAID';
        } else if (newPaidAmount > 0) {
            paymentStatus = 'PARTIAL';
        }

        await query(
            `UPDATE invoices SET paid_amount = $1, outstanding_amount = $2, payment_status = $3 WHERE id = $4`,
            [newPaidAmount, newOutstanding, paymentStatus, payment.invoice_id]
        );

        // Delete voucher entries and voucher
        if (payment.voucher_id) {
            await query('DELETE FROM voucher_entries WHERE voucher_id = $1', [payment.voucher_id]);
            await query('DELETE FROM vouchers WHERE id = $1', [payment.voucher_id]);
        }

        // Delete payment
        await query('DELETE FROM payments WHERE id = $1', [id]);

        await query('COMMIT');
        res.status(204).json({ status: 'success', data: null });
    } catch (error) {
        await query('ROLLBACK');
        next(error);
    }
};
