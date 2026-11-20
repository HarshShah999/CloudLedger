import { query, Queryable } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { fromPaise, toPaise } from '../utils/money';
import { toDateString } from './financialYear';
import { postVoucher, removeVoucher, assertPeriodOpen } from './posting';
import { refreshInvoicePaymentStatus, resolveDepositLedger } from './paymentService';

export type Direction = 'RECEIPT' | 'PAYMENT';

/** Which invoice types a receipt or payment can settle. */
export const SETTLES: Record<Direction, string[]> = {
    RECEIPT: ['SALES', 'DEBIT_NOTE'], // party owes us
    PAYMENT: ['PURCHASE', 'CREDIT_NOTE'], // we owe the party
};

export interface Allocation {
    invoiceId: string;
    amount: number;
}

export interface ReceiptInput {
    partyLedgerId: string;
    direction: Direction;
    date: string;
    amount: number;
    depositLedgerId?: string | null;
    paymentMode?: string | null;
    referenceNumber?: string | null;
    notes?: string | null;
    allocations?: Allocation[];
}

/** Outstanding invoices of a party that a receipt/payment can settle, oldest first. */
export const openInvoices = async (db: Queryable, companyId: string, partyLedgerId: string, direction: Direction) =>
    (
        await db.query(
            `SELECT i.id, i.invoice_number, i.type, i.date, i.due_date, i.grand_total,
                    i.grand_total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS outstanding
             FROM invoices i
             WHERE i.company_id = $1 AND i.party_ledger_id = $2 AND i.type = ANY($3)
               AND i.grand_total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) > 0
             ORDER BY COALESCE(i.due_date, i.date), i.date, i.invoice_number`,
            [companyId, partyLedgerId, SETTLES[direction]]
        )
    ).rows.map((r) => ({ ...r, grand_total: Number(r.grand_total), outstanding: Number(r.outstanding) }));

/** Validates and writes allocation rows. `available` is what is left of the receipt to allocate. */
const applyAllocations = async (
    db: Queryable,
    companyId: string,
    receipt: { id: string; party_ledger_id: string; direction: Direction; date: string; payment_mode: string | null; reference_number: string | null; notes: string | null; deposit_ledger_id: string },
    allocations: Allocation[],
    availableP: number
) => {
    const merged = new Map<string, number>();
    for (const a of allocations) {
        const p = toPaise(a.amount);
        if (p <= 0) continue;
        merged.set(a.invoiceId, (merged.get(a.invoiceId) ?? 0) + p);
    }
    const total = [...merged.values()].reduce((s, v) => s + v, 0);
    if (total > availableP) {
        throw new AppError(`Allocated ${fromPaise(total).toFixed(2)} is more than the available ${fromPaise(availableP).toFixed(2)}`, 400);
    }

    for (const [invoiceId, amountP] of merged) {
        const inv = (
            await db.query('SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE', [invoiceId, companyId])
        ).rows[0];
        if (!inv) throw new AppError('Invoice not found', 404);
        if (inv.party_ledger_id !== receipt.party_ledger_id) {
            throw new AppError(`${inv.invoice_number} belongs to a different party`, 400);
        }
        if (!SETTLES[receipt.direction].includes(inv.type)) {
            throw new AppError(`A ${receipt.direction.toLowerCase()} cannot settle ${inv.invoice_number}`, 400);
        }
        const paid = await db.query('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1', [invoiceId]);
        const outstandingP = toPaise(inv.grand_total) - toPaise(paid.rows[0].paid);
        if (amountP > outstandingP) {
            throw new AppError(`Amount exceeds the outstanding balance of ${fromPaise(outstandingP).toFixed(2)} on ${inv.invoice_number}`, 400);
        }
        await db.query(
            `INSERT INTO payments (company_id, invoice_id, receipt_id, payment_date, amount, payment_mode,
                                   reference_number, notes, deposit_ledger_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [companyId, invoiceId, receipt.id, receipt.date, fromPaise(amountP), receipt.payment_mode,
                receipt.reference_number, receipt.notes, receipt.deposit_ledger_id]
        );
        await refreshInvoicePaymentStatus(db, invoiceId);
    }
};

/**
 * Records money received from / paid to a party, posts one Receipt/Payment
 * voucher, and settles the chosen invoices. Anything not allocated is an advance.
 */
export const createReceipt = async (db: Queryable, companyId: string, input: ReceiptInput) => {
    if (input.direction !== 'RECEIPT' && input.direction !== 'PAYMENT') throw new AppError('Invalid direction', 400);
    const party = (await db.query('SELECT id, name FROM ledgers WHERE id = $1 AND company_id = $2', [input.partyLedgerId, companyId])).rows[0];
    if (!party) throw new AppError('Party not found in this company', 400);

    const amountP = toPaise(input.amount);
    if (amountP <= 0) throw new AppError('Amount must be greater than zero', 400);
    const amount = fromPaise(amountP);
    const date = toDateString(input.date);
    const depositLedgerId = await resolveDepositLedger(db, companyId, input);
    if (depositLedgerId === input.partyLedgerId) throw new AppError('Party and cash/bank account must be different', 400);
    const isReceipt = input.direction === 'RECEIPT';

    const voucher = await postVoucher(db, {
        companyId,
        voucherTypeName: isReceipt ? 'Receipt' : 'Payment',
        date,
        narration:
            `${isReceipt ? 'Received from' : 'Paid to'} ${party.name}` +
            (input.referenceNumber ? ` (Ref ${input.referenceNumber})` : '') +
            (input.notes ? ` – ${input.notes}` : ''),
        entries: [
            { ledgerId: depositLedgerId, amount, type: isReceipt ? 'Dr' : 'Cr', instrumentNumber: input.referenceNumber },
            { ledgerId: input.partyLedgerId, amount, type: isReceipt ? 'Cr' : 'Dr' },
        ],
    });

    const receipt = (
        await db.query(
            `INSERT INTO receipts (company_id, party_ledger_id, direction, date, amount, deposit_ledger_id,
                                   payment_mode, reference_number, notes, voucher_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [companyId, input.partyLedgerId, input.direction, date, amount, depositLedgerId,
                input.paymentMode || null, input.referenceNumber || null, input.notes || null, voucher.id]
        )
    ).rows[0];

    await applyAllocations(db, companyId, receipt, input.allocations ?? [], amountP);
    return receipt;
};

/** Allocates an advance (unallocated part of a receipt) to invoices. */
export const allocateReceipt = async (db: Queryable, companyId: string, receiptId: string, allocations: Allocation[]) => {
    const receipt = (await db.query('SELECT * FROM receipts WHERE id = $1 AND company_id = $2 FOR UPDATE', [receiptId, companyId])).rows[0];
    if (!receipt) throw new AppError('Receipt not found', 404);
    const used = await db.query('SELECT COALESCE(SUM(amount), 0) AS used FROM payments WHERE receipt_id = $1', [receiptId]);
    await applyAllocations(db, companyId, receipt, allocations, toPaise(receipt.amount) - toPaise(used.rows[0].used));
    return receipt;
};

/** Deletes a receipt, its voucher and its allocations; invoice balances are restored. */
export const deleteReceipt = async (db: Queryable, companyId: string, receiptId: string) => {
    const receipt = (await db.query('SELECT * FROM receipts WHERE id = $1 AND company_id = $2', [receiptId, companyId])).rows[0];
    if (!receipt) throw new AppError('Receipt not found', 404);
    await assertPeriodOpen(db, companyId, receipt.date);
    const invoices = (await db.query('SELECT DISTINCT invoice_id FROM payments WHERE receipt_id = $1', [receiptId])).rows;
    await db.query('DELETE FROM payments WHERE receipt_id = $1', [receiptId]);
    await db.query('DELETE FROM receipts WHERE id = $1', [receiptId]);
    if (receipt.voucher_id) await removeVoucher(db, companyId, receipt.voucher_id);
    for (const { invoice_id } of invoices) await refreshInvoicePaymentStatus(db, invoice_id);
};

/** Receipts/payments with how much is allocated and how much is still an advance. */
export const listReceipts = async (companyId: string, filters: { partyLedgerId?: string; direction?: string; onlyUnallocated?: boolean }) => {
    const params: any[] = [companyId];
    let where = 'r.company_id = $1';
    if (filters.partyLedgerId) {
        params.push(filters.partyLedgerId);
        where += ` AND r.party_ledger_id = $${params.length}`;
    }
    if (filters.direction) {
        params.push(filters.direction);
        where += ` AND r.direction = $${params.length}`;
    }
    const rows = (
        await query(
            `SELECT r.*, l.name AS party_name, d.name AS deposit_ledger_name, v.voucher_number,
                    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.receipt_id = r.id), 0) AS allocated,
                    COALESCE((SELECT json_agg(json_build_object('invoice_id', p.invoice_id, 'invoice_number', i.invoice_number, 'amount', p.amount))
                              FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.receipt_id = r.id), '[]') AS allocations
             FROM receipts r
             JOIN ledgers l ON l.id = r.party_ledger_id
             JOIN ledgers d ON d.id = r.deposit_ledger_id
             LEFT JOIN vouchers v ON v.id = r.voucher_id
             WHERE ${where}
             ORDER BY r.date DESC, r.created_at DESC`,
            params
        )
    ).rows.map((r) => {
        const unallocated = fromPaise(toPaise(r.amount) - toPaise(r.allocated));
        return { ...r, amount: Number(r.amount), allocated: Number(r.allocated), unallocated };
    });
    return filters.onlyUnallocated ? rows.filter((r) => r.unallocated > 0) : rows;
};
