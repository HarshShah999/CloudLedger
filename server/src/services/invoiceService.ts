import { Queryable } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { calculateInvoice, isInterStateSupply, CalcResult } from './invoiceCalc';
import { resolveFinancialYear, toDateString } from './financialYear';
import { ensureSystemLedger } from './companySetup';
import { postVoucher, removeVoucher, assertPeriodOpen, DrCr, EntryInput } from './posting';
import { reserveNumber } from './numberSeries';

export type InvoiceType = 'SALES' | 'PURCHASE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';

export interface InvoiceLineInput {
    itemId?: string | null;
    description?: string | null;
    quantity: number;
    rate: number;
    taxRate: number;
    discountPercent?: number;
}

export interface InvoiceInput {
    partyLedgerId: string;
    salesLedgerId: string;
    invoiceNumber?: string | null;
    date: string | Date;
    dueDate?: string | Date | null;
    type: InvoiceType;
    placeOfSupply?: string | null;
    items: InvoiceLineInput[];
    notes?: string | null;
    discountPercent?: number;
    originalInvoiceNumber?: string | null;
    originalInvoiceDate?: string | Date | null;
}

const VOUCHER_TYPE: Record<InvoiceType, string> = {
    SALES: 'Sales',
    PURCHASE: 'Purchase',
    CREDIT_NOTE: 'Credit Note',
    DEBIT_NOTE: 'Debit Note',
};

/**
 * Accounting sides per document:
 *  SALES        Party Dr | Sales Cr        | Output tax Cr
 *  PURCHASE     Party Cr | Purchase Dr     | Input tax Dr
 *  CREDIT_NOTE  Party Cr | Sales return Dr | Output tax Dr (reversal)
 *  DEBIT_NOTE   Party Dr | Purchase ret Cr | Input tax Cr (reversal)
 */
const SIDES: Record<InvoiceType, { party: DrCr; account: DrCr; tax: 'OUTPUT' | 'INPUT' }> = {
    SALES: { party: 'Dr', account: 'Cr', tax: 'OUTPUT' },
    PURCHASE: { party: 'Cr', account: 'Dr', tax: 'INPUT' },
    CREDIT_NOTE: { party: 'Cr', account: 'Dr', tax: 'OUTPUT' },
    DEBIT_NOTE: { party: 'Dr', account: 'Cr', tax: 'INPUT' },
};

/** Stock direction: +1 adds to stock, -1 removes. */
const STOCK_SIGN: Record<InvoiceType, number> = { SALES: -1, PURCHASE: 1, CREDIT_NOTE: 1, DEBIT_NOTE: -1 };

const opposite = (t: DrCr): DrCr => (t === 'Dr' ? 'Cr' : 'Dr');

/** Builds balanced voucher entries for an invoice. */
export const buildInvoiceEntries = async (
    db: Queryable,
    companyId: string,
    type: InvoiceType,
    partyLedgerId: string,
    accountLedgerId: string,
    calc: CalcResult
): Promise<EntryInput[]> => {
    const side = SIDES[type];
    const entries: EntryInput[] = [
        { ledgerId: partyLedgerId, amount: calc.grandTotal, type: side.party },
        { ledgerId: accountLedgerId, amount: calc.subtotal, type: side.account },
    ];
    const taxes: [string, number][] = [
        [`${side.tax}_CGST`, calc.cgst],
        [`${side.tax}_SGST`, calc.sgst],
        [`${side.tax}_IGST`, calc.igst],
    ];
    for (const [code, amount] of taxes) {
        if (amount !== 0) {
            entries.push({ ledgerId: await ensureSystemLedger(db, companyId, code), amount, type: side.account });
        }
    }
    if (calc.roundOff !== 0) {
        // A positive round-off increases what the party owes, so it sits on the account side.
        entries.push({
            ledgerId: await ensureSystemLedger(db, companyId, 'ROUND_OFF'),
            amount: Math.abs(calc.roundOff),
            type: calc.roundOff > 0 ? side.account : opposite(side.account),
        });
    }
    return entries;
};

const loadContext = async (db: Queryable, companyId: string, input: InvoiceInput) => {
    const company = (await db.query('SELECT state, round_off_invoices FROM companies WHERE id = $1', [companyId])).rows[0];
    if (!company) throw new AppError('Company not found', 404);

    const ledgers = await db.query('SELECT id, state FROM ledgers WHERE company_id = $1 AND id = ANY($2::uuid[])', [
        companyId,
        [input.partyLedgerId, input.salesLedgerId],
    ]);
    const party = ledgers.rows.find((l) => l.id === input.partyLedgerId);
    if (!party) throw new AppError('Party ledger not found in this company', 400);
    if (!ledgers.rows.find((l) => l.id === input.salesLedgerId)) {
        throw new AppError('Sales/Purchase ledger not found in this company', 400);
    }
    if (input.partyLedgerId === input.salesLedgerId) {
        throw new AppError('Party and Sales/Purchase ledger must be different', 400);
    }

    const itemIds = input.items.map((i) => i.itemId).filter(Boolean) as string[];
    if (itemIds.length) {
        const unique = [...new Set(itemIds)];
        const found = await db.query('SELECT id FROM items WHERE company_id = $1 AND id = ANY($2::uuid[])', [companyId, unique]);
        if (found.rows.length !== unique.length) throw new AppError('One or more items do not belong to this company', 400);
    }

    const placeOfSupply = input.placeOfSupply || party.state || company.state || null;
    return {
        company,
        placeOfSupply,
        isInterState: isInterStateSupply(company.state, placeOfSupply),
    };
};

const adjustStock = async (db: Queryable, type: InvoiceType, lines: { item_id?: string | null; itemId?: string | null; quantity: number | string }[], direction: 1 | -1) => {
    for (const l of lines) {
        const itemId = l.itemId ?? l.item_id;
        if (!itemId) continue;
        await db.query('UPDATE items SET current_quantity = current_quantity + $1 WHERE id = $2', [
            STOCK_SIGN[type] * direction * Number(l.quantity),
            itemId,
        ]);
    }
};

const insertLines = async (db: Queryable, invoiceId: string, input: InvoiceInput, calc: CalcResult) => {
    for (let idx = 0; idx < calc.lines.length; idx++) {
        const src = input.items[idx];
        const l = calc.lines[idx];
        await db.query(
            `INSERT INTO invoice_items (
                invoice_id, item_id, description, quantity, rate, amount, discount_percent, discount_amount,
                taxable_amount, tax_rate, tax_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
                igst_rate, igst_amount, total_amount
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [
                invoiceId, src.itemId || null, src.description || null, l.quantity, l.rate, l.amount,
                l.discount_percent, l.discount_amount, l.taxable_amount, l.tax_rate, l.tax_amount,
                l.cgst_rate, l.cgst_amount, l.sgst_rate, l.sgst_amount, l.igst_rate, l.igst_amount, l.total_amount,
            ]
        );
    }
};

const assertUniqueNumber = async (db: Queryable, companyId: string, type: string, fyId: string, number: string, exceptId?: string) => {
    const r = await db.query(
        `SELECT 1 FROM invoices WHERE company_id = $1 AND type = $2 AND financial_year_id = $3
         AND lower(invoice_number) = lower($4) AND ($5::uuid IS NULL OR id <> $5)`,
        [companyId, type, fyId, number, exceptId ?? null]
    );
    if (r.rows.length) throw new AppError(`Number ${number} is already used in this financial year`, 400);
    if (number.length > 16 && (type === 'SALES' || type === 'CREDIT_NOTE' || type === 'DEBIT_NOTE')) {
        throw new AppError('GST invoice numbers can be at most 16 characters', 400);
    }
};

const narrationFor = (type: InvoiceType, number: string, notes?: string | null) => {
    const label = { SALES: 'Sales invoice', PURCHASE: 'Purchase bill', CREDIT_NOTE: 'Credit note', DEBIT_NOTE: 'Debit note' }[type];
    return `${label} ${number}${notes ? ` – ${notes}` : ''}`;
};

/** Creates an invoice with its accounting voucher and stock movement. */
export const createInvoice = async (db: Queryable, companyId: string, input: InvoiceInput) => {
    if (!input.items?.length) throw new AppError('Invoice must have at least one item', 400);
    const type = input.type;
    if (!SIDES[type]) throw new AppError('Invalid invoice type', 400);

    const ctx = await loadContext(db, companyId, input);
    const date = toDateString(input.date);
    const fy = await resolveFinancialYear(db, companyId, date);

    let calc: CalcResult;
    try {
        calc = calculateInvoice(input.items, {
            invoiceDiscountPercent: input.discountPercent,
            isInterState: ctx.isInterState,
            roundOff: ctx.company.round_off_invoices,
        });
    } catch (e) {
        throw new AppError((e as Error).message, 400);
    }

    const number = await reserveNumber(db, companyId, type, fy, input.invoiceNumber);
    await assertUniqueNumber(db, companyId, type, fy.id, number);

    const voucher = await postVoucher(
        db,
        {
            companyId,
            voucherTypeName: VOUCHER_TYPE[type],
            voucherNumber: number,
            date,
            narration: narrationFor(type, number, input.notes),
            entries: await buildInvoiceEntries(db, companyId, type, input.partyLedgerId, input.salesLedgerId, calc),
        },
        undefined,
        { fy, numberDocType: type }
    );

    const inv = (
        await db.query(
            `INSERT INTO invoices (
                company_id, voucher_id, party_ledger_id, sales_ledger_id, invoice_number, date, due_date, type,
                subtotal, tax_total, grand_total, notes, discount_percent, discount_amount, paid_amount,
                outstanding_amount, payment_status, original_invoice_number, original_invoice_date,
                financial_year_id, place_of_supply, round_off
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,$11,'UNPAID',$15,$16,$17,$18,$19)
            RETURNING *`,
            [
                companyId, voucher.id, input.partyLedgerId, input.salesLedgerId, number, date,
                input.dueDate ? toDateString(input.dueDate) : null, type, calc.subtotal, calc.taxTotal,
                calc.grandTotal, input.notes || null, Number(input.discountPercent || 0), calc.invoiceDiscount,
                input.originalInvoiceNumber || null,
                input.originalInvoiceDate ? toDateString(input.originalInvoiceDate) : null,
                fy.id, ctx.placeOfSupply, calc.roundOff,
            ]
        )
    ).rows[0];

    await insertLines(db, inv.id, input, calc);
    await adjustStock(db, type, input.items, 1);
    return inv;
};

const loadInvoice = async (db: Queryable, companyId: string, id: string) => {
    const r = await db.query('SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, companyId]);
    if (!r.rows.length) throw new AppError('Invoice not found', 404);
    return r.rows[0];
};

/** Replaces an invoice's lines, totals and voucher. Not allowed once payments exist. */
export const updateInvoice = async (db: Queryable, companyId: string, id: string, input: InvoiceInput) => {
    if (!input.items?.length) throw new AppError('Invoice must have at least one item', 400);
    const existing = await loadInvoice(db, companyId, id);
    const type: InvoiceType = existing.type; // the document type never changes

    const paid = await db.query('SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id = $1', [id]);
    if (paid.rows[0].n > 0) throw new AppError('Cannot edit an invoice that has payments. Delete the payments first.', 400);
    await assertPeriodOpen(db, companyId, existing.date);

    const ctx = await loadContext(db, companyId, input);
    const date = toDateString(input.date);
    const fy = await resolveFinancialYear(db, companyId, date);

    let calc: CalcResult;
    try {
        calc = calculateInvoice(input.items, {
            invoiceDiscountPercent: input.discountPercent,
            isInterState: ctx.isInterState,
            roundOff: ctx.company.round_off_invoices,
        });
    } catch (e) {
        throw new AppError((e as Error).message, 400);
    }

    const number = input.invoiceNumber?.trim() || existing.invoice_number;
    await assertUniqueNumber(db, companyId, type, fy.id, number, id);

    // Reverse old stock, remove old lines
    const oldLines = await db.query('SELECT item_id, quantity FROM invoice_items WHERE invoice_id = $1', [id]);
    await adjustStock(db, type, oldLines.rows, -1);
    await db.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);

    const voucherInput = {
        companyId,
        voucherTypeName: VOUCHER_TYPE[type],
        voucherNumber: number,
        date,
        narration: narrationFor(type, number, input.notes),
        entries: await buildInvoiceEntries(db, companyId, type, input.partyLedgerId, input.salesLedgerId, calc),
    };
    const voucher = existing.voucher_id
        ? await postVoucher(db, voucherInput, existing.voucher_id, { fy })
        : await postVoucher(db, voucherInput, undefined, { fy, numberDocType: type });

    const inv = (
        await db.query(
            `UPDATE invoices SET
                voucher_id = $1, party_ledger_id = $2, sales_ledger_id = $3, invoice_number = $4, date = $5,
                due_date = $6, subtotal = $7, tax_total = $8, grand_total = $9, notes = $10,
                discount_percent = $11, discount_amount = $12, paid_amount = 0, outstanding_amount = $9,
                payment_status = 'UNPAID', original_invoice_number = $13, original_invoice_date = $14,
                financial_year_id = $15, place_of_supply = $16, round_off = $17
             WHERE id = $18 RETURNING *`,
            [
                voucher.id, input.partyLedgerId, input.salesLedgerId, number, date,
                input.dueDate ? toDateString(input.dueDate) : null, calc.subtotal, calc.taxTotal, calc.grandTotal,
                input.notes || null, Number(input.discountPercent || 0), calc.invoiceDiscount,
                input.originalInvoiceNumber || null,
                input.originalInvoiceDate ? toDateString(input.originalInvoiceDate) : null,
                fy.id, ctx.placeOfSupply, calc.roundOff, id,
            ]
        )
    ).rows[0];

    await insertLines(db, id, input, calc);
    await adjustStock(db, type, input.items, 1);
    return inv;
};

/** Deletes an invoice, its voucher and reverses stock. Not allowed once payments exist. */
export const deleteInvoice = async (db: Queryable, companyId: string, id: string) => {
    const existing = await loadInvoice(db, companyId, id);
    const paid = await db.query('SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id = $1', [id]);
    if (paid.rows[0].n > 0) throw new AppError('Cannot delete an invoice that has payments. Delete the payments first.', 400);
    await assertPeriodOpen(db, companyId, existing.date);

    const lines = await db.query('SELECT item_id, quantity FROM invoice_items WHERE invoice_id = $1', [id]);
    await adjustStock(db, existing.type, lines.rows, -1);
    await db.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);
    await db.query('DELETE FROM invoices WHERE id = $1', [id]);
    if (existing.voucher_id) await removeVoucher(db, companyId, existing.voucher_id);
};
