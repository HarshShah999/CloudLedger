import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

export const getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
    const companyId = req.company!.id;

    try {
        // 1. Get Total Receivables (Unpaid/Partial Sales Invoices)
        const receivablesRes = await query(
            `SELECT COALESCE(SUM(outstanding_amount), 0) as total
             FROM invoices
             WHERE company_id = $1 
             AND type = 'SALES'
             AND payment_status IN ('UNPAID', 'PARTIAL')`,
            [companyId]
        );

        // 2. Get Total Payables (Unpaid/Partial Purchase Invoices)
        const payablesRes = await query(
            `SELECT COALESCE(SUM(outstanding_amount), 0) as total
             FROM invoices
             WHERE company_id = $1 
             AND type = 'PURCHASE'
             AND payment_status IN ('UNPAID', 'PARTIAL')`,
            [companyId]
        );

        // 3. Cash and bank balances (opening + all entries), by account group
        const balancesRes = await query(
            `SELECT kind, COALESCE(SUM(balance), 0) AS balance FROM (
                SELECT CASE WHEN g.code = 'CASH_IN_HAND' OR g.name ILIKE '%cash%' THEN 'cash' ELSE 'bank' END AS kind,
                       (CASE WHEN l.opening_balance_type = 'Cr' THEN -l.opening_balance ELSE l.opening_balance END)
                       + COALESCE((SELECT SUM(CASE WHEN ve.type = 'Dr' THEN ve.amount ELSE -ve.amount END)
                                   FROM voucher_entries ve WHERE ve.ledger_id = l.id), 0) AS balance
                FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id
                WHERE l.company_id = $1
                  AND (g.code IN ('CASH_IN_HAND', 'BANK_ACCOUNTS', 'BANK_OD') OR g.name ILIKE '%cash%' OR g.name ILIKE '%bank%')
             ) t GROUP BY kind`,
            [companyId]
        );
        const cashBalance = Number(balancesRes.rows.find((r) => r.kind === 'cash')?.balance || 0);
        const bankBalance = Number(balancesRes.rows.find((r) => r.kind === 'bank')?.balance || 0);

        // 4. Get Monthly Income and Expenses together
        const monthlyRes = await query(
            `SELECT 
                TO_CHAR(date, 'Mon') as month,
                EXTRACT(MONTH FROM date) as month_num,
                EXTRACT(YEAR FROM date) as year_num,
                type,
                COALESCE(SUM(grand_total), 0) as total
             FROM invoices
             WHERE company_id = $1 
             AND type IN ('SALES', 'PURCHASE')
             AND NOT is_opening
             AND date >= CURRENT_DATE - INTERVAL '6 months'
             GROUP BY TO_CHAR(date, 'Mon'), EXTRACT(MONTH FROM date), EXTRACT(YEAR FROM date), type
             ORDER BY EXTRACT(YEAR FROM date), EXTRACT(MONTH FROM date)`,
            [companyId]
        );

        // Build month labels and data arrays
        const monthsMap = new Map();
        monthlyRes.rows.forEach(row => {
            const key = `${row.year_num}-${row.month_num}`;
            if (!monthsMap.has(key)) {
                monthsMap.set(key, {
                    month: row.month,
                    income: 0,
                    expenses: 0
                });
            }
            const data = monthsMap.get(key);
            if (row.type === 'SALES') {
                data.income = Number(row.total);
            } else if (row.type === 'PURCHASE') {
                data.expenses = Number(row.total);
            }
        });

        const sortedMonths = Array.from(monthsMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([_, data]) => data);

        const monthlyData = {
            labels: sortedMonths.map(m => m.month),
            income: sortedMonths.map(m => m.income),
            expenses: sortedMonths.map(m => m.expenses)
        };

        // 6. Get Recent Transactions (Last 10 vouchers)
        const transactionsRes = await query(
            `SELECT 
                v.id,
                v.voucher_number,
                v.date,
                v.total_amount,
                v.narration,
                vt.name as voucher_type
             FROM vouchers v
             LEFT JOIN voucher_types vt ON v.voucher_type_id = vt.id
             WHERE v.company_id = $1
             ORDER BY v.date DESC, v.created_at DESC
             LIMIT 10`,
            [companyId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                kpis: {
                    receivables: Number(receivablesRes.rows[0].total),
                    payables: Number(payablesRes.rows[0].total),
                    cashBalance: Number(cashBalance),
                    bankBalance: Number(bankBalance)
                },
                monthlyData,
                recentTransactions: transactionsRes.rows
            }
        });

    } catch (error) {
        next(error);
    }
};
