
import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

export const getBankTransactions = async (req: Request, res: Response, next: NextFunction) => {
    const { ledgerId } = req.params;
    const { fromDate, toDate } = req.query;

    try {
        const result = await query(
            `SELECT 
                ve.id, 
                ve.amount, 
                ve.type, 
                ve.instrument_number, 
                ve.instrument_date, 
                ve.bank_allocation_date,
                v.date as voucher_date,
                v.voucher_number,
                v.narration,
                vt.name as voucher_type
            FROM voucher_entries ve
            JOIN vouchers v ON ve.voucher_id = v.id
            JOIN voucher_types vt ON v.voucher_type_id = vt.id
            WHERE ve.ledger_id = $1 
            AND v.date BETWEEN $2 AND $3
            ORDER BY v.date ASC`,
            [ledgerId, fromDate, toDate]
        );

        res.status(200).json({
            status: 'success',
            results: result.rows.length,
            data: {
                transactions: result.rows
            }
        });
    } catch (error) {
        next(error);
    }
};

export const updateReconciliation = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { bankAllocationDate } = req.body;

    try {
        const result = await query(
            `UPDATE voucher_entries 
            SET bank_allocation_date = $1
            WHERE id = $2
            RETURNING *`,
            [bankAllocationDate, id]
        );

        if (result.rows.length === 0) {
            return next(new AppError('Transaction not found', 404));
        }

        res.status(200).json({
            status: 'success',
            data: {
                transaction: result.rows[0]
            }
        });
    } catch (error) {
        next(error);
    }
};
