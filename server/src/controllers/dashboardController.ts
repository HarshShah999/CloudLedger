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
             AND date >= date_trunc('month', CURRENT_DATE) - INTERVAL '5 months'
             AND date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
             GROUP BY TO_CHAR(date, 'Mon'), EXTRACT(MONTH FROM date), EXTRACT(YEAR FROM date), type
             ORDER BY EXTRACT(YEAR FROM date), EXTRACT(MONTH FROM date)`,
            [companyId]
        );

        // The last six months in order (Jun, Jul, ... Nov), including months with no bills
        const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const now = new Date();
        const months = Array.from({ length: 6 }, (_, i) => {
            const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
            return { key: `${d.getFullYear()}-${d.getMonth() + 1}`, month: MONTHS[d.getMonth()], income: 0, expenses: 0 };
        });
        const byKey = new Map(months.map((m) => [m.key, m]));
        for (const row of monthlyRes.rows) {
            const m = byKey.get(`${Number(row.year_num)}-${Number(row.month_num)}`);
            if (!m) continue;
            if (row.type === 'SALES') m.income = Number(row.total);
            else if (row.type === 'PURCHASE') m.expenses = Number(row.total);
        }

        const monthlyData = {
            labels: months.map((m) => m.month),
            income: months.map((m) => m.income),
            expenses: months.map((m) => m.expenses),
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
