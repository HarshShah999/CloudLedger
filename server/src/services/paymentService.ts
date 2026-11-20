import { Queryable } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { fromPaise, toPaise } from '../utils/money';
import { toDateString } from './financialYear';
import { ensureSystemLedger } from './companySetup';
import { postVoucher, removeVoucher, assertPeriodOpen } from './posting';

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
        `SELECT i.grand_total, COALESCE(SUM(p.amount), 0) AS paid
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
const resolveDepositLedger = async (db: Queryable, companyId: string, input: PaymentInput): Promise<string> => {
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
 */
export const createPayment = async (db: Queryable, companyId: string, input: PaymentInput) => {
    const invRes = await db.query('SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE', [
        input.invoiceId,
        companyId,
    ]);
    if (!invRes.rows.length) throw new AppError('Invoice not found', 404);
    const invoice = invRes.rows[0];

    const amountP = toPaise(input.amount);
    if (amountP <= 0) throw new AppError('Amount must be greater than zero', 400);

    const paidSoFar = await db.query('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1', [invoice.id]);
    const outstandingP = toPaise(invoice.grand_total) - toPaise(paidSoFar.rows[0].paid);
    if (amountP > outstandingP) {
        throw new AppError(`Amount exceeds the outstanding balance of ${fromPaise(outstandingP).toFixed(2)}`, 400);
    }

    const depositLedgerId = await resolveDepositLedger(db, companyId, input);
    // Party owes us (SALES, DEBIT_NOTE) -> we receive. Otherwise we pay.
    const isReceipt = invoice.type === 'SALES' || invoice.type === 'DEBIT_NOTE';
    const date = toDateString(input.paymentDate);
    const amount = fromPaise(amountP);

    const voucher = await postVoucher(db, {
        companyId,
        voucherTypeName: isReceipt ? 'Receipt' : 'Payment',
        date,
        narration:
            `${isReceipt ? 'Received against' : 'Paid against'} ${invoice.invoice_number}` +
            (input.referenceNumber ? ` (Ref ${input.referenceNumber})` : '') +
            (input.notes ? ` – ${input.notes}` : ''),
        entries: [
            { ledgerId: depositLedgerId, amount, type: isReceipt ? 'Dr' : 'Cr', instrumentNumber: input.referenceNumber },
            { ledgerId: invoice.party_ledger_id, amount, type: isReceipt ? 'Cr' : 'Dr' },
        ],
    });

    const payment = (
        await db.query(
            `INSERT INTO payments (company_id, invoice_id, voucher_id, payment_date, amount, payment_mode,
                                   reference_number, notes, deposit_ledger_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [companyId, invoice.id, voucher.id, date, amount, input.paymentMode || null,
                input.referenceNumber || null, input.notes || null, depositLedgerId]
        )
    ).rows[0];

    await refreshInvoicePaymentStatus(db, invoice.id);
    return payment;
};

export const deletePayment = async (db: Queryable, companyId: string, paymentId: string) => {
    const r = await db.query('SELECT * FROM payments WHERE id = $1 AND company_id = $2', [paymentId, companyId]);
    if (!r.rows.length) throw new AppError('Payment not found', 404);
    const payment = r.rows[0];
    await assertPeriodOpen(db, companyId, payment.payment_date);

    await db.query('DELETE FROM payments WHERE id = $1', [paymentId]);
    if (payment.voucher_id) await removeVoucher(db, companyId, payment.voucher_id);
    await refreshInvoicePaymentStatus(db, payment.invoice_id);
};
