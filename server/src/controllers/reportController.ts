import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

export const getTrialBalance = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, startDate, endDate } = req.query;

    if (!companyId) {
        return next(new AppError('Company ID is required', 400));
    }

    try {
        // Calculate balances from voucher entries
        const result = await query(
            `SELECT 
         l.id, l.name, lg.name as group_name, lg.type as group_type,
         l.opening_balance, l.opening_balance_type,
         COALESCE(SUM(CASE WHEN ve.type = 'Dr' THEN ve.amount ELSE 0 END), 0) as total_debit,
         COALESCE(SUM(CASE WHEN ve.type = 'Cr' THEN ve.amount ELSE 0 END), 0) as total_credit
       FROM ledgers l
       LEFT JOIN ledger_groups lg ON l.group_id = lg.id
       LEFT JOIN voucher_entries ve ON l.id = ve.ledger_id
       LEFT JOIN vouchers v ON ve.voucher_id = v.id
       WHERE l.company_id = $1
       AND (v.date IS NULL OR (v.date >= $2 AND v.date <= $3))
       GROUP BY l.id, l.name, lg.name, lg.type, l.opening_balance, l.opening_balance_type
       ORDER BY lg.type, lg.name, l.name`,
            [companyId, startDate || '1900-01-01', endDate || '2100-12-31']
        );

        // Process balances in JS (simplified)
        const report = result.rows.map(row => {
            let balance = 0;
            let balanceType = 'Dr';

            const openDr = row.opening_balance_type === 'Dr' ? Number(row.opening_balance) : 0;
            const openCr = row.opening_balance_type === 'Cr' ? Number(row.opening_balance) : 0;
            const currentDr = Number(row.total_debit);
            const currentCr = Number(row.total_credit);

            const totalDr = openDr + currentDr;
            const totalCr = openCr + currentCr;

            if (totalDr > totalCr) {
                balance = totalDr - totalCr;
                balanceType = 'Dr';
            } else {
                balance = totalCr - totalDr;
                balanceType = 'Cr';
            }

            return {
                ...row,
                closing_balance: balance,
                closing_balance_type: balanceType
            };
        });

        res.status(200).json({
            status: 'success',
            data: {
                report,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Placeholder for P&L and Balance Sheet (similar logic but filtered by Group Type)
export const getPnL = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, startDate, endDate } = req.query;

    if (!companyId || !startDate || !endDate) {
        return next(new AppError('Company ID, start date, and end date are required', 400));
    }

    try {
        // Get all income and expense ledgers with their balances
        const query_text = `
            SELECT 
                lg.name as group_name,
                lg.type as group_type,
                l.id as ledger_id,
                l.name as ledger_name,
                l.opening_balance,
                l.opening_balance_type,
                COALESCE(SUM(CASE WHEN ve.type = 'Dr' THEN ve.amount ELSE 0 END), 0) as total_debit,
                COALESCE(SUM(CASE WHEN ve.type = 'Cr' THEN ve.amount ELSE 0 END), 0) as total_credit
            FROM ledgers l
            LEFT JOIN ledger_groups lg ON l.group_id = lg.id
            LEFT JOIN voucher_entries ve ON l.id = ve.ledger_id
            LEFT JOIN vouchers v ON ve.voucher_id = v.id
            WHERE l.company_id = $1
            AND lg.type IN ('Income', 'Expense')
            AND (v.date IS NULL OR (v.date >= $2 AND v.date <= $3))
            GROUP BY lg.name, lg.type, l.id, l.name, l.opening_balance, l.opening_balance_type
            ORDER BY lg.type, l.name
        `;

        const result = await query(query_text, [companyId, startDate, endDate]);

        // Calculate balances for each ledger
        const ledgers = result.rows.map((row: any) => {
            const debit = parseFloat(row.total_debit);
            const credit = parseFloat(row.total_credit);

            // For Income: Credit increases, Debit decreases
            // For Expense: Debit increases, Credit decreases
            let balance = 0;
            if (row.group_type === 'Income') {
                balance = credit - debit;
            } else {
                balance = debit - credit;
            }

            return {
                group_name: row.group_name,
                group_type: row.group_type,
                ledger_name: row.ledger_name,
                balance: Math.abs(balance),
                balance_type: balance >= 0 ? 'Cr' : 'Dr'
            };
        });

        // Group by type
        const income = ledgers.filter((l: any) => l.group_type === 'Income');
        const expenses = ledgers.filter((l: any) => l.group_type === 'Expense');

        // Calculate totals
        const totalIncome = income.reduce((sum: number, l: any) => sum + l.balance, 0);
        const totalExpenses = expenses.reduce((sum: number, l: any) => sum + l.balance, 0);
        const netProfit = totalIncome - totalExpenses;

        res.status(200).json({
            status: 'success',
            data: {
                income,
                expenses,
                totalIncome,
                totalExpenses,
                netProfit,
                netProfitType: netProfit >= 0 ? 'Profit' : 'Loss'
            }
        });
    } catch (error) {
        console.error('❌ P&L error:', error);
        next(error);
    }
};

export const getBalanceSheet = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, asOfDate } = req.query;

    if (!companyId || !asOfDate) {
        return next(new AppError('Company ID and as-of date are required', 400));
    }

    try {
        // Get all asset and liability ledgers with their balances
        const query_text = `
            SELECT 
                lg.name as group_name,
                lg.type as group_type,
                l.id as ledger_id,
                l.name as ledger_name,
                l.opening_balance,
                l.opening_balance_type,
                COALESCE(SUM(CASE WHEN ve.type = 'Dr' THEN ve.amount ELSE 0 END), 0) as total_debit,
                COALESCE(SUM(CASE WHEN ve.type = 'Cr' THEN ve.amount ELSE 0 END), 0) as total_credit
            FROM ledgers l
            LEFT JOIN ledger_groups lg ON l.group_id = lg.id
            LEFT JOIN voucher_entries ve ON l.id = ve.ledger_id
            LEFT JOIN vouchers v ON ve.voucher_id = v.id
            WHERE l.company_id = $1
            AND lg.type IN ('Asset', 'Liability')
            AND (v.date IS NULL OR v.date <= $2)
            GROUP BY lg.name, lg.type, l.id, l.name, l.opening_balance, l.opening_balance_type
            ORDER BY lg.type, l.name
        `;

        const result = await query(query_text, [companyId, asOfDate]);

        // Calculate balances for each ledger
        const ledgers = result.rows.map((row: any) => {
            const openingBalance = parseFloat(row.opening_balance) || 0;
            const debit = parseFloat(row.total_debit);
            const credit = parseFloat(row.total_credit);

            // Start with opening balance
            let balance = openingBalance;

            // For Assets: Debit increases, Credit decreases
            // For Liabilities: Credit increases, Debit decreases
            if (row.group_type === 'Asset') {
                balance += (debit - credit);
            } else {
                balance += (credit - debit);
            }

            return {
                group_name: row.group_name,
                group_type: row.group_type,
                ledger_name: row.ledger_name,
                balance: Math.abs(balance),
                balance_type: balance >= 0 ? row.opening_balance_type : (row.opening_balance_type === 'Dr' ? 'Cr' : 'Dr')
            };
        });

        // Group by type
        const assets = ledgers.filter((l: any) => l.group_type === 'Asset');
        const liabilities = ledgers.filter((l: any) => l.group_type === 'Liability');

        // Calculate totals
        const totalAssets = assets.reduce((sum: number, l: any) => sum + l.balance, 0);
        const totalLiabilities = liabilities.reduce((sum: number, l: any) => sum + l.balance, 0);
        const difference = totalAssets - totalLiabilities;

        res.status(200).json({
            status: 'success',
            data: {
                assets,
                liabilities,
                totalAssets,
                totalLiabilities,
                difference
            }
        });
    } catch (error) {
        console.error('❌ Balance Sheet error:', error);
        next(error);
    }
};
