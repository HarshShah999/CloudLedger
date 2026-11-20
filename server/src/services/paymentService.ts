import { Queryable, query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { fromPaise, toPaise } from '../utils/money';
import { toDateString } from './financialYear';
import { ensureSystemLedger } from './companySetup';
import { removeVoucher, assertPeriodOpen } from './posting';
import { createReceipt, deleteReceipt, SETTLES } from './receiptService';

export interface PaymentInput {
    invoiceId: string;
    paymentDate: string | Date;
    amount: number;
    depositLedgerId?: string | null;
    paymentMode?: string | null;
    referenceNumber?: string | null;
    notes?: string | null;
}

/** Recomputes paid / outstanding / status from the payments table. */
export const refreshInvoicePaymentStatus = async (db: Queryable, invoiceId: string) => {
    const r = await db.query(
        `SELECT i.grand_total - i.tds_amount AS grand_total, COALESCE(SUM(p.amount), 0) AS paid
         FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
         WHERE i.id = $1 GROUP BY i.id`,
        [invoiceId]
    );
    if (!r.rows.length) return;
    const total = toPaise(r.rows[0].grand_total);
    const paid = toPaise(r.rows[0].paid);
    const status = paid <= 0 ? 'UNPAID' : paid >= total ? 'PAID' : 'PARTIAL';
    await db.query('UPDATE invoices SET paid_amount = $1, outstanding_amount = $2, payment_status = $3 WHERE id = $4', [
        fromPaise(paid),
        fromPaise(Math.max(total - paid, 0)),
        status,
        invoiceId,
    ]);
};

/** Picks the cash/bank ledger the money moved through. */
export const resolveDepositLedger = async (
    db: Queryable,
    companyId: string,
    input: { depositLedgerId?: string | null; paymentMode?: string | null }
): Promise<string> => {
    if (input.depositLedgerId) {
        const r = await db.query(
            `SELECT l.id FROM ledgers l LEFT JOIN ledger_groups g ON g.id = l.group_id
             WHERE l.id = $1 AND l.company_id = $2`,
            [input.depositLedgerId, companyId]
        );
        if (!r.rows.length) throw new AppError('Selected cash/bank account not found in this company', 400);
        return input.depositLedgerId;
    }
    const mode = (input.paymentMode || 'Cash').toLowerCase();
    if (mode === 'cash') return ensureSystemLedger(db, companyId, 'CASH');

    // Non-cash with no account chosen: use the only bank account if there is exactly one.
    const banks = await db.query(
        `SELECT l.id FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id
         WHERE l.company_id = $1 AND (g.code IN ('BANK_ACCOUNTS', 'BANK_OD') OR g.name ILIKE '%bank%')`,
        [companyId]
    );
    if (banks.rows.length === 1) return banks.rows[0].id;
    throw new AppError('Please choose which bank account received/paid this amount', 400);
};

/**
 * Records money received against a sales invoice / debit note (Receipt voucher)
 * or paid against a purchase bill / credit note (Payment voucher).
 * Implemented as a receipt with a single allocation.
 */
export const createPayment = async (db: Queryable, companyId: string, input: PaymentInput) => {
    const inv = (await db.query('SELECT * FROM invoices WHERE id = $1 AND company_id = $2', [input.invoiceId, companyId])).rows[0];
    if (inv?.status === 'CANCELLED') throw new AppError('This invoice is cancelled', 400);
    if (!inv) throw new AppError('Invoice not found', 404);
    const direction = SETTLES.RECEIPT.includes(inv.type) ? 'RECEIPT' : SETTLES.PAYMENT.includes(inv.type) ? 'PAYMENT' : null;
    if (!direction) throw new AppError('Payments can only be recorded against invoices, bills and notes', 400);

    // Check before posting so an over-payment never becomes an accidental advance
    const paid = await db.query('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1', [inv.id]);
    const outstandingP = toPaise(inv.grand_total) - toPaise(inv.tds_amount) - toPaise(paid.rows[0].paid);
    if (toPaise(input.amount) > outstandingP) {
        throw new AppError(`Amount exceeds the outstanding balance of ${fromPaise(outstandingP).toFixed(2)}`, 400);
    }

    const receipt = await createReceipt(db, companyId, {
        partyLedgerId: inv.party_ledger_id,
        direction,
        date: toDateString(input.paymentDate),
        amount: input.amount,
        depositLedgerId: input.depositLedgerId,
        paymentMode: input.paymentMode,
        referenceNumber: input.referenceNumber,
        notes: input.notes || `Against ${inv.invoice_number}`,
        allocations: [{ invoiceId: inv.id, amount: input.amount }],
    });
    return (await db.query('SELECT * FROM payments WHERE receipt_id = $1', [receipt.id])).rows[0];
};

/**
 * Removes a payment row. For a receipt that only settled this invoice the whole
 * receipt (and voucher) is deleted; otherwise only the allocation is removed and
 * that money becomes an advance again.
 */
export const deletePayment = async (db: Queryable, companyId: string, paymentId: string) => {
    const r = await db.query('SELECT * FROM payments WHERE id = $1 AND company_id = $2', [paymentId, companyId]);
    if (!r.rows.length) throw new AppError('Payment not found', 404);
    const payment = r.rows[0];
    await assertPeriodOpen(db, companyId, payment.payment_date);

    if (payment.receipt_id) {
        const rec = (await db.query('SELECT amount FROM receipts WHERE id = $1', [payment.receipt_id])).rows[0];
        const others = await db.query('SELECT COUNT(*)::int AS n FROM payments WHERE receipt_id = $1 AND id <> $2', [payment.receipt_id, paymentId]);
        if (others.rows[0].n === 0 && toPaise(rec.amount) === toPaise(payment.amount)) {
            await deleteReceipt(db, companyId, payment.receipt_id);
            return;
        }
        await db.query('DELETE FROM payments WHERE id = $1', [paymentId]);
        await refreshInvoicePaymentStatus(db, payment.invoice_id);
        return;
    }

    // Legacy payment with its own voucher
    await db.query('DELETE FROM payments WHERE id = $1', [paymentId]);
    if (payment.voucher_id) await removeVoucher(db, companyId, payment.voucher_id);
    await refreshInvoicePaymentStatus(db, payment.invoice_id);
};

/** Payments recorded against invoices, newest first. */
export const listPayments = async (companyId: string, invoiceId?: string) => {
    const params: any[] = [companyId];
    let sql = `SELECT p.*, i.invoice_number, l.name AS deposit_ledger_name
               FROM payments p
               LEFT JOIN invoices i ON i.id = p.invoice_id
               LEFT JOIN ledgers l ON l.id = p.deposit_ledger_id
               WHERE p.company_id = $1`;
    if (invoiceId) {
        params.push(invoiceId);
        sql += ` AND p.invoice_id = $${params.length}`;
    }
    sql += ' ORDER BY p.payment_date DESC, p.created_at DESC';
    return (await query(sql, params)).rows;
};
