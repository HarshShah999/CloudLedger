import { Queryable } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { calculateInvoice, isInterStateSupply, CalcResult } from './invoiceCalc';
import { resolveFinancialYear, toDateString } from './financialYear';
import { ensureSystemLedger } from './companySetup';
import { postVoucher, removeVoucher, assertPeriodOpen, DrCr, EntryInput } from './posting';
import { reserveNumber } from './numberSeries';
import { fromPaise, toPaise } from '../utils/money';
import { SupplyType, isAlwaysInterState, isWithoutPayment, stateCode, stateName } from '../utils/gst';

/** Documents that post to the books and move stock. */
export type PostingType = 'SALES' | 'PURCHASE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
/** Documents that only record an offer or order: no accounting, no stock. */
export type OrderType = 'QUOTATION' | 'SALES_ORDER' | 'PURCHASE_ORDER';
export type InvoiceType = PostingType | OrderType;

export const ORDER_TYPES: OrderType[] = ['QUOTATION', 'SALES_ORDER', 'PURCHASE_ORDER'];
export const isPosting = (t: string): t is PostingType => ['SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(t);

/** Allowed statuses per order type; the first is the default. */
export const ORDER_STATUSES: Record<OrderType, string[]> = {
    QUOTATION: ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CONVERTED'],
    SALES_ORDER: ['OPEN', 'CLOSED', 'CONVERTED'],
    PURCHASE_ORDER: ['OPEN', 'CLOSED', 'CONVERTED'],
};

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
    /** Quotations / orders only */
    status?: string | null;
    validUntil?: string | Date | null;
    sourceDocumentId?: string | null;
    /** GST supply type: NORMAL, SEZ_WPAY, SEZ_WOPAY, EXPORT_WPAY, EXPORT_WOPAY, DEEMED_EXPORT */
    supplyType?: string | null;
    /** Purchase under reverse charge (we pay the GST) */
    reverseCharge?: boolean;
    /** Income-tax TDS deducted on a purchase bill */
    tdsSection?: string | null;
    tdsRate?: number | null;
    shippingBillNumber?: string | null;
    shippingBillDate?: string | Date | null;
    portCode?: string | null;
    /** Transport details for the e-way bill */
    transportMode?: string | null;
    transportDistanceKm?: number | null;
    vehicleNumber?: string | null;
    transporterId?: string | null;
    transporterName?: string | null;
    transportDocNumber?: string | null;
    transportDocDate?: string | Date | null;
}

/** Stores transport details (kept out of the main insert/update for readability). */
const saveTransport = async (db: Queryable, id: string, input: InvoiceInput) => {
    await db.query(
        `UPDATE invoices SET transport_mode = $1, transport_distance_km = $2, vehicle_number = $3, transporter_id = $4,
                transporter_name = $5, transport_doc_number = $6, transport_doc_date = $7 WHERE id = $8`,
        [
            input.transportMode || null, input.transportDistanceKm ?? null,
            input.vehicleNumber ? input.vehicleNumber.replace(/[\s-]/g, '').toUpperCase() : null,
            input.transporterId || null, input.transporterName || null, input.transportDocNumber || null,
            input.transportDocDate ? toDateString(input.transportDocDate) : null, id,
        ]
    );
};

/** An invoice with an active IRN is final: it can only be cancelled on the IRP or adjusted by a credit note. */
const assertNoActiveIrn = (inv: { irn: string | null; irn_status: string | null }) => {
    if (inv.irn && inv.irn_status === 'ACTIVE') {
        throw new AppError('This invoice has an e-invoice IRN. Cancel the IRN on the IRP first (within 24 hours) or issue a credit note.', 400);
    }
};

/** Values for supply_type .. port_code, in column order. */
const gstColumns = (input: InvoiceInput, doc: { supply: string; rcm: boolean; tdsRate: number; tdsAmount: number }) => [
    doc.supply, doc.rcm, doc.tdsRate ? input.tdsSection || null : null, doc.tdsRate, doc.tdsAmount,
    input.shippingBillNumber || null, input.shippingBillDate ? toDateString(input.shippingBillDate) : null, input.portCode || null,
];

const orderStatus = (type: InvoiceType, requested?: string | null): string | null => {
    if (isPosting(type)) return null;
    const allowed = ORDER_STATUSES[type];
    if (requested && !allowed.includes(requested)) throw new AppError(`Invalid status for ${type.toLowerCase()}`, 400);
    return requested || allowed[0];
};

const VOUCHER_TYPE: Record<PostingType, string> = {
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
const SIDES: Record<PostingType, { party: DrCr; account: DrCr; tax: 'OUTPUT' | 'INPUT' }> = {
    SALES: { party: 'Dr', account: 'Cr', tax: 'OUTPUT' },
    PURCHASE: { party: 'Cr', account: 'Dr', tax: 'INPUT' },
    CREDIT_NOTE: { party: 'Cr', account: 'Dr', tax: 'OUTPUT' },
    DEBIT_NOTE: { party: 'Dr', account: 'Cr', tax: 'INPUT' },
};

/** Stock direction: +1 adds to stock, -1 removes. */
const STOCK_SIGN: Record<PostingType, number> = { SALES: -1, PURCHASE: 1, CREDIT_NOTE: 1, DEBIT_NOTE: -1 };

const opposite = (t: DrCr): DrCr => (t === 'Dr' ? 'Cr' : 'Dr');

/**
 * Builds balanced voucher entries for an invoice.
 *  - Reverse charge (purchases): the supplier is paid without GST; we book the
 *    input tax (ITC) and an equal "GST payable under RCM" liability.
 *  - TDS (purchases): the supplier is credited net of TDS; TDS Payable is credited.
 */
export const buildInvoiceEntries = async (
    db: Queryable,
    companyId: string,
    type: PostingType,
    partyLedgerId: string,
    accountLedgerId: string,
    calc: CalcResult,
    opts: { reverseCharge?: boolean; tdsAmount?: number } = {}
): Promise<EntryInput[]> => {
    const side = SIDES[type];
    const tds = opts.tdsAmount || 0;
    const entries: EntryInput[] = [
        { ledgerId: partyLedgerId, amount: fromPaise(toPaise(calc.grandTotal) - toPaise(tds)), type: side.party },
        { ledgerId: accountLedgerId, amount: calc.subtotal, type: side.account },
    ];
    const taxes: [string, number][] = [
        ['CGST', calc.cgst],
        ['SGST', calc.sgst],
        ['IGST', calc.igst],
    ];
    for (const [tax, amount] of taxes) {
        if (amount === 0) continue;
        entries.push({ ledgerId: await ensureSystemLedger(db, companyId, `${side.tax}_${tax}`), amount, type: side.account });
        if (opts.reverseCharge) {
            entries.push({ ledgerId: await ensureSystemLedger(db, companyId, `RCM_${tax}`), amount, type: opposite(side.account) });
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
    if (tds > 0) {
        entries.push({ ledgerId: await ensureSystemLedger(db, companyId, 'TDS_PAYABLE'), amount: tds, type: side.party });
    }
    return entries;
};

/**
 * Totals for a document, applying the supply type (exports/SEZ always IGST;
 * zero-rated without payment carries no tax), reverse charge and TDS.
 */
const computeDocument = (input: InvoiceInput, type: InvoiceType, ctx: Awaited<ReturnType<typeof loadContext>>) => {
    const salesSide = ['SALES', 'CREDIT_NOTE', 'DEBIT_NOTE', 'QUOTATION', 'SALES_ORDER'].includes(type);
    const supply = (input.supplyType ||
        (salesSide && ctx.partyRegistration === 'SEZ' ? 'SEZ_WPAY' : salesSide && ctx.partyRegistration === 'OVERSEAS' ? 'EXPORT_WPAY' : 'NORMAL')) as SupplyType;
    const rcm = !!input.reverseCharge;
    if (rcm && type !== 'PURCHASE') throw new AppError('Reverse charge applies to purchase bills only', 400);
    if (supply !== 'NORMAL' && !salesSide) {
        throw new AppError('Export / SEZ supply types apply to sales documents', 400);
    }
    let calc: CalcResult;
    try {
        calc = calculateInvoice(input.items, {
            invoiceDiscountPercent: input.discountPercent,
            isInterState: isAlwaysInterState(supply) || ctx.isInterState,
            withoutPayment: isWithoutPayment(supply),
            // Under reverse charge the supplier's bill excludes tax: round what is actually payable
            roundOff: ctx.company.round_off_invoices && !rcm,
        });
    } catch (e) {
        throw new AppError((e as Error).message, 400);
    }
    if (rcm) {
        const payableP = toPaise(calc.subtotal);
        const rounded = ctx.company.round_off_invoices ? Math.round(payableP / 100) * 100 : payableP;
        calc = { ...calc, roundOff: fromPaise(rounded - payableP), grandTotal: fromPaise(rounded) };
    }

    const tdsRate = Number(input.tdsRate || 0);
    if (tdsRate && type !== 'PURCHASE') throw new AppError('TDS can be deducted on purchase bills only', 400);
    if (tdsRate < 0 || tdsRate > 30) throw new AppError('Invalid TDS rate', 400);
    // TDS is on the value excluding GST, rounded to the rupee (section 288B)
    const tdsAmount = tdsRate ? Math.round((calc.subtotal * tdsRate) / 100) : 0;
    return { calc, supply, rcm, tdsRate, tdsAmount, isInterState: isAlwaysInterState(supply) || ctx.isInterState };
};

const loadContext = async (db: Queryable, companyId: string, input: InvoiceInput) => {
    const company = (await db.query('SELECT state, round_off_invoices FROM companies WHERE id = $1', [companyId])).rows[0];
    if (!company) throw new AppError('Company not found', 404);

    const ledgers = await db.query('SELECT id, state, gst_registration_type FROM ledgers WHERE company_id = $1 AND id = ANY($2::uuid[])', [
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

    // Exports go to "Foreign Country"; otherwise the buyer's state (or our own for walk-in sales)
    const isExport = (input.supplyType || '').startsWith('EXPORT') || (!input.supplyType && party.gst_registration_type === 'OVERSEAS');
    const rawPos = input.placeOfSupply || (isExport ? '96' : party.state || company.state || null);
    const placeOfSupply = rawPos ? stateName(stateCode(rawPos)) ?? rawPos : null;
    return {
        company,
        placeOfSupply,
        partyRegistration: party.gst_registration_type as string | null,
        isInterState: isInterStateSupply(company.state, placeOfSupply),
    };
};

const adjustStock = async (db: Queryable, type: InvoiceType, lines: { item_id?: string | null; itemId?: string | null; quantity: number | string }[], direction: 1 | -1) => {
    if (!isPosting(type)) return; // quotations and orders do not move stock
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
    const label = { SALES: 'Sales invoice', PURCHASE: 'Purchase bill', CREDIT_NOTE: 'Credit note', DEBIT_NOTE: 'Debit note' }[type as PostingType] ?? type;
    return `${label} ${number}${notes ? ` – ${notes}` : ''}`;
};

/** Creates an invoice with its accounting voucher and stock movement. */
export const createInvoice = async (db: Queryable, companyId: string, input: InvoiceInput) => {
    if (!input.items?.length) throw new AppError('Invoice must have at least one item', 400);
    const type = input.type;
    if (!isPosting(type) && !ORDER_TYPES.includes(type as OrderType)) throw new AppError('Invalid document type', 400);
    const status = orderStatus(type, input.status);

    const ctx = await loadContext(db, companyId, input);
    const date = toDateString(input.date);
    const fy = await resolveFinancialYear(db, companyId, date);

    const doc = computeDocument(input, type, ctx);
    const calc = doc.calc;

    const number = await reserveNumber(db, companyId, type, fy, input.invoiceNumber);
    await assertUniqueNumber(db, companyId, type, fy.id, number);

    const voucher = isPosting(type)
        ? await postVoucher(
              db,
              {
                  companyId,
                  voucherTypeName: VOUCHER_TYPE[type],
                  voucherNumber: number,
                  date,
                  narration: narrationFor(type, number, input.notes),
                  entries: await buildInvoiceEntries(db, companyId, type, input.partyLedgerId, input.salesLedgerId, calc, { reverseCharge: doc.rcm, tdsAmount: doc.tdsAmount }),
              },
              undefined,
              { fy, numberDocType: type }
          )
        : null;

    const inv = (
        await db.query(
            `INSERT INTO invoices (
                company_id, voucher_id, party_ledger_id, sales_ledger_id, invoice_number, date, due_date, type,
                subtotal, tax_total, grand_total, notes, discount_percent, discount_amount, paid_amount,
                outstanding_amount, payment_status, original_invoice_number, original_invoice_date,
                financial_year_id, place_of_supply, round_off, status, valid_until, source_document_id,
                supply_type, reverse_charge, tds_section, tds_rate, tds_amount, shipping_bill_number,
                shipping_bill_date, port_code
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,$23,$24,$15,$16,$17,$18,$19,$20,$21,$22,
                      $25,$26,$27,$28,$29,$30,$31,$32)
            RETURNING *`,
            [
                companyId, voucher?.id ?? null, input.partyLedgerId, input.salesLedgerId, number, date,
                input.dueDate ? toDateString(input.dueDate) : null, type, calc.subtotal, calc.taxTotal,
                calc.grandTotal, input.notes || null, Number(input.discountPercent || 0), calc.invoiceDiscount,
                input.originalInvoiceNumber || null,
                input.originalInvoiceDate ? toDateString(input.originalInvoiceDate) : null,
                fy.id, ctx.placeOfSupply, calc.roundOff, status,
                input.validUntil ? toDateString(input.validUntil) : null, input.sourceDocumentId ?? null,
                // Quotations and orders are never "owed": no outstanding, no payment status
                isPosting(type) ? fromPaise(toPaise(calc.grandTotal) - toPaise(doc.tdsAmount)) : 0, isPosting(type) ? 'UNPAID' : null,
                ...gstColumns(input, doc),
            ]
        )
    ).rows[0];

    await insertLines(db, inv.id, input, calc);
    await adjustStock(db, type, input.items, 1);
    await saveTransport(db, inv.id, input);
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
    if (existing.status === 'CONVERTED') throw new AppError('This document has already been converted and cannot be edited', 400);
    assertNoActiveIrn(existing);

    const ctx = await loadContext(db, companyId, input);
    const date = toDateString(input.date);
    const fy = await resolveFinancialYear(db, companyId, date);

    const doc = computeDocument(input, type, ctx);
    const calc = doc.calc;

    const number = input.invoiceNumber?.trim() || existing.invoice_number;
    await assertUniqueNumber(db, companyId, type, fy.id, number, id);

    // Reverse old stock, remove old lines
    const oldLines = await db.query('SELECT item_id, quantity FROM invoice_items WHERE invoice_id = $1', [id]);
    await adjustStock(db, type, oldLines.rows, -1);
    await db.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);

    let voucher: { id: string } | null = null;
    if (isPosting(type)) {
        const voucherInput = {
            companyId,
            voucherTypeName: VOUCHER_TYPE[type],
            voucherNumber: number,
            date,
            narration: narrationFor(type, number, input.notes),
            entries: await buildInvoiceEntries(db, companyId, type, input.partyLedgerId, input.salesLedgerId, calc, { reverseCharge: doc.rcm, tdsAmount: doc.tdsAmount }),
        };
        voucher = existing.voucher_id
            ? await postVoucher(db, voucherInput, existing.voucher_id, { fy })
            : await postVoucher(db, voucherInput, undefined, { fy, numberDocType: type });
    }

    const inv = (
        await db.query(
            `UPDATE invoices SET
                voucher_id = $1, party_ledger_id = $2, sales_ledger_id = $3, invoice_number = $4, date = $5,
                due_date = $6, subtotal = $7, tax_total = $8, grand_total = $9, notes = $10,
                discount_percent = $11, discount_amount = $12, paid_amount = 0,
                outstanding_amount = $20, payment_status = $21,
                supply_type = $22, reverse_charge = $23, tds_section = $24, tds_rate = $25, tds_amount = $26,
                shipping_bill_number = $27, shipping_bill_date = $28, port_code = $29,
                original_invoice_number = $13, original_invoice_date = $14,
                financial_year_id = $15, place_of_supply = $16, round_off = $17,
                valid_until = COALESCE($19, valid_until)
             WHERE id = $18 RETURNING *`,
            [
                voucher?.id ?? null, input.partyLedgerId, input.salesLedgerId, number, date,
                input.dueDate ? toDateString(input.dueDate) : null, calc.subtotal, calc.taxTotal, calc.grandTotal,
                input.notes || null, Number(input.discountPercent || 0), calc.invoiceDiscount,
                input.originalInvoiceNumber || null,
                input.originalInvoiceDate ? toDateString(input.originalInvoiceDate) : null,
                fy.id, ctx.placeOfSupply, calc.roundOff, id,
                input.validUntil ? toDateString(input.validUntil) : null,
                isPosting(type) ? fromPaise(toPaise(calc.grandTotal) - toPaise(doc.tdsAmount)) : 0, isPosting(type) ? 'UNPAID' : null,
                ...gstColumns(input, doc),
            ]
        )
    ).rows[0];

    await insertLines(db, id, input, calc);
    await adjustStock(db, type, input.items, 1);
    await saveTransport(db, id, input);
    return inv;
};

/** Deletes an invoice, its voucher and reverses stock. Not allowed once payments exist. */
export const deleteInvoice = async (db: Queryable, companyId: string, id: string) => {
    const existing = await loadInvoice(db, companyId, id);
    const paid = await db.query('SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id = $1', [id]);
    if (paid.rows[0].n > 0) throw new AppError('Cannot delete an invoice that has payments. Delete the payments first.', 400);
    await assertPeriodOpen(db, companyId, existing.date);
    assertNoActiveIrn(existing);

    const lines = await db.query('SELECT item_id, quantity FROM invoice_items WHERE invoice_id = $1', [id]);
    await adjustStock(db, existing.type, lines.rows, -1);
    await db.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);
    await db.query('DELETE FROM invoices WHERE id = $1', [id]);
    if (existing.voucher_id) await removeVoucher(db, companyId, existing.voucher_id);
};

/** Where each document type can be converted to. */
export const CONVERSIONS: Record<OrderType, InvoiceType[]> = {
    QUOTATION: ['SALES_ORDER', 'SALES'],
    SALES_ORDER: ['SALES'],
    PURCHASE_ORDER: ['PURCHASE'],
};

/**
 * Creates the next document in the chain (Quotation -> Sales Order -> Invoice,
 * Purchase Order -> Purchase Bill) with the same party, lines and terms.
 */
export const convertDocument = async (
    db: Queryable,
    companyId: string,
    id: string,
    to: InvoiceType,
    opts: { date?: string; invoiceNumber?: string | null; dueDate?: string | null } = {}
) => {
    const src = await loadInvoice(db, companyId, id);
    const allowed = CONVERSIONS[src.type as OrderType];
    if (!allowed) throw new AppError('Only quotations and orders can be converted', 400);
    if (!allowed.includes(to)) throw new AppError(`A ${src.type.toLowerCase().replace('_', ' ')} cannot be converted to ${to.toLowerCase().replace('_', ' ')}`, 400);
    if (src.status === 'CONVERTED') throw new AppError('This document has already been converted', 400);
    if (src.status === 'DECLINED') throw new AppError('A declined quotation cannot be converted', 400);

    const lines = (await db.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY created_at, id', [id])).rows;
    const created = await createInvoice(db, companyId, {
        type: to,
        partyLedgerId: src.party_ledger_id,
        salesLedgerId: src.sales_ledger_id,
        date: opts.date || toDateString(new Date()),
        dueDate: opts.dueDate || null,
        invoiceNumber: opts.invoiceNumber || null,
        placeOfSupply: src.place_of_supply,
        notes: src.notes,
        discountPercent: Number(src.discount_percent || 0),
        sourceDocumentId: src.id,
        items: lines.map((l) => ({
            itemId: l.item_id,
            description: l.description,
            quantity: Number(l.quantity),
            rate: Number(l.rate),
            taxRate: Number(l.tax_rate),
            discountPercent: Number(l.discount_percent || 0),
        })),
    });
    await db.query(`UPDATE invoices SET status = 'CONVERTED' WHERE id = $1`, [id]);
    return created;
};

/** Changes the status of a quotation or order (e.g. SENT, ACCEPTED, DECLINED, CLOSED). */
export const setDocumentStatus = async (db: Queryable, companyId: string, id: string, status: string) => {
    const doc = await loadInvoice(db, companyId, id);
    if (isPosting(doc.type)) throw new AppError('Only quotations and orders have a status', 400);
    if (status === 'CONVERTED') throw new AppError('Use “Convert” to convert a document', 400);
    if (doc.status === 'CONVERTED') throw new AppError('This document has already been converted', 400);
    if (!ORDER_STATUSES[doc.type as OrderType].includes(status)) throw new AppError('Invalid status', 400);
    return (await db.query('UPDATE invoices SET status = $1 WHERE id = $2 RETURNING *', [status, id])).rows[0];
};
