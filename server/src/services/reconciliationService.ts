/** Bank reconciliation: entries in a bank ledger and the date each cleared the bank. */
import { query } from '../config/db';

export const bankTransactions = async (companyId: string, ledgerId: string, fromDate: string, toDate: string) =>
    (
        await query(
            `SELECT ve.id, ve.amount, ve.type, ve.instrument_number, ve.instrument_date, ve.bank_allocation_date,
                    v.date AS voucher_date, v.voucher_number, v.narration, vt.name AS voucher_type
             FROM voucher_entries ve
             JOIN vouchers v ON ve.voucher_id = v.id
             LEFT JOIN voucher_types vt ON v.voucher_type_id = vt.id
             WHERE ve.ledger_id = $1 AND v.company_id = $2 AND v.date BETWEEN $3 AND $4
             ORDER BY v.date ASC, v.created_at ASC`,
            [ledgerId, companyId, fromDate, toDate]
        )
    ).rows;

export const setBankDate = async (entryId: string, bankDate: string | null) =>
    (await query('UPDATE voucher_entries SET bank_allocation_date = $1 WHERE id = $2 RETURNING *', [bankDate, entryId])).rows[0];
