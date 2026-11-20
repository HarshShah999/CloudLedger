import { Request, Response } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

export const getBankTransactions = async (req: Request, res: Response) => {
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) throw new AppError('fromDate and toDate are required', 400);
    const result = await query(
        `SELECT ve.id, ve.amount, ve.type, ve.instrument_number, ve.instrument_date, ve.bank_allocation_date,
                v.date AS voucher_date, v.voucher_number, v.narration, vt.name AS voucher_type
         FROM voucher_entries ve
         JOIN vouchers v ON ve.voucher_id = v.id
         LEFT JOIN voucher_types vt ON v.voucher_type_id = vt.id
         WHERE ve.ledger_id = $1 AND v.company_id = $2 AND v.date BETWEEN $3 AND $4
         ORDER BY v.date ASC, v.created_at ASC`,
        [req.params.ledgerId, req.company!.id, fromDate, toDate]
    );
    res.status(200).json({ status: 'success', results: result.rows.length, data: { transactions: result.rows } });
};

export const updateReconciliation = async (req: Request, res: Response) => {
    const { bankAllocationDate } = req.body;
    if (bankAllocationDate && !/^\d{4}-\d{2}-\d{2}/.test(bankAllocationDate)) {
        throw new AppError('bankAllocationDate must be YYYY-MM-DD', 400);
    }
    const result = await query('UPDATE voucher_entries SET bank_allocation_date = $1 WHERE id = $2 RETURNING *', [
        bankAllocationDate ? String(bankAllocationDate).slice(0, 10) : null,
        req.params.id,
    ]);
    res.status(200).json({ status: 'success', data: { transaction: result.rows[0] } });
};
