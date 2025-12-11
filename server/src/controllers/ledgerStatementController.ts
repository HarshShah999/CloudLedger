import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

export const getLedgerStatement = async (req: Request, res: Response, next: NextFunction) => {
    const { ledgerId } = req.params;
    const { startDate, endDate, companyId } = req.query;

    try {
        // Get ledger details
        const ledgerResult = await query(
            `SELECT l.*, lg.name as group_name, lg.type as group_type
             FROM ledgers l
             LEFT JOIN ledger_groups lg ON l.group_id = lg.id
             WHERE l.id = $1 AND l.company_id = $2`,
            [ledgerId, companyId]
        );

        if (ledgerResult.rows.length === 0) {
            return next(new AppError('Ledger not found', 404));
        }

        const ledger = ledgerResult.rows[0];

        // Get all transactions for this ledger
        const transactionsQuery = `
            SELECT 
                ve.id,
                ve.amount,
                ve.type,
                v.voucher_number,
                v.date,
                v.narration,
                vt.name as voucher_type_name,
                v.id as voucher_id
            FROM voucher_entries ve
            JOIN vouchers v ON ve.voucher_id = v.id
            JOIN voucher_types vt ON v.voucher_type_id = vt.id
            WHERE ve.ledger_id = $1
            AND v.company_id = $2
            ${startDate ? 'AND v.date >= $3' : ''}
            ${endDate ? 'AND v.date <= $4' : ''}
            ORDER BY v.date ASC, v.created_at ASC
        `;

        const params: any[] = [ledgerId, companyId];
        if (startDate) params.push(startDate);
        if (endDate) params.push(endDate);

        const transactionsResult = await query(transactionsQuery, params);

        // Calculate running balance
        let runningBalance = parseFloat(ledger.opening_balance) || 0;
        const openingType = ledger.opening_balance_type;

        const transactions = transactionsResult.rows.map((txn: any) => {
            const amount = parseFloat(txn.amount);

            // Update running balance based on ledger group type
            if (ledger.group_type === 'Asset' || ledger.group_type === 'Expense') {
                // For Assets and Expenses: Dr increases, Cr decreases
                if (txn.type === 'Dr') {
                    runningBalance += amount;
                } else {
                    runningBalance -= amount;
                }
            } else {
                // For Liabilities and Income: Cr increases, Dr decreases
                if (txn.type === 'Cr') {
                    runningBalance += amount;
                } else {
                    runningBalance -= amount;
                }
            }

            return {
                ...txn,
                debit: txn.type === 'Dr' ? amount : 0,
                credit: txn.type === 'Cr' ? amount : 0,
                balance: runningBalance,
                balance_type: runningBalance >= 0 ? openingType : (openingType === 'Dr' ? 'Cr' : 'Dr')
            };
        });

        res.status(200).json({
            status: 'success',
            data: {
                ledger: {
                    id: ledger.id,
                    name: ledger.name,
                    group_name: ledger.group_name,
                    group_type: ledger.group_type,
                    opening_balance: ledger.opening_balance,
                    opening_balance_type: ledger.opening_balance_type,
                    closing_balance: runningBalance,
                    closing_balance_type: runningBalance >= 0 ? openingType : (openingType === 'Dr' ? 'Cr' : 'Dr')
                },
                transactions
            }
        });
    } catch (error) {
        console.error('❌ Ledger statement error:', error);
        next(error);
    }
};
