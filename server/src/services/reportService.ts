import { query, Queryable } from '../config/db';
import { openingStockPaise, stockValuePaise } from './stockService';
import { fromPaise, toPaise } from '../utils/money';
import { indianFinancialYear, toDateString } from './financialYear';

/*
 * Conventions: every balance is held as a signed paise integer, Dr positive,
 * Cr negative. Converted to {amount, Dr|Cr} only for output.
 *
 * Income/Expense ledgers start every financial year at zero (their prior-year
 * totals roll into "Profit & Loss A/c" on the balance sheet), exactly like Tally.
 * Asset/Liability ledgers carry their balances forward.
 */

export type Nature = 'Asset' | 'Liability' | 'Income' | 'Expense';

export interface LedgerBalance {
    id: string;
    name: string;
    code: string | null;
    group_id: string | null;
    group_name: string | null;
    group_type: Nature;
    /** Root group code (e.g. SALES_ACCOUNTS) used for trading vs P&L split. */
    root_code: string | null;
    opening: number; // signed paise at start of period
    debit: number; // paise in period
    credit: number; // paise in period
    closing: number; // signed paise at end of period
}

const signedToDrCr = (signed: number) => ({ amount: fromPaise(Math.abs(signed)), type: signed >= 0 ? 'Dr' : 'Cr' });

/** Financial-year start for a date: the company's FY if one covers it, else the Indian FY. */
export const fyStartFor = async (db: Queryable, companyId: string, date: string) => {
    const r = await db.query(
        'SELECT start_date FROM financial_years WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1',
        [companyId, date]
    );
    return r.rows[0]?.start_date ?? indianFinancialYear(date).startDate;
};

const loadGroups = async (db: Queryable, companyId: string) => {
    const r = await db.query('SELECT id, name, type, code, parent_id FROM ledger_groups WHERE company_id = $1', [companyId]);
    const byId = new Map(r.rows.map((g) => [g.id, g]));
    const rootCode = (id: string | null): string | null => {
        let g = id ? byId.get(id) : undefined;
        let code: string | null = null;
        for (let i = 0; g && i < 20; i++) {
            if (g.code) code = g.code;
            g = g.parent_id ? byId.get(g.parent_id) : undefined;
        }
        return code;
    };
    return { byId, rootCode };
};

/**
 * Opening, period debit/credit and closing for every ledger.
 * `from` may be null for "from the beginning" (balance sheet).
 */
export const ledgerBalances = async (
    companyId: string,
    from: string | null,
    to: string,
    db: Queryable = { query }
): Promise<LedgerBalance[]> => {
    const periodStart = from ?? '0001-01-01';
    const plStart = from ? await fyStartFor(db, companyId, from) : await fyStartFor(db, companyId, to);

    const r = await db.query(
        `SELECT l.id, l.name, l.code, l.group_id, g.name AS group_name, COALESCE(g.type, 'Asset') AS group_type,
                CASE WHEN l.opening_balance_type = 'Cr' THEN -l.opening_balance ELSE l.opening_balance END AS ob,
                COALESCE(SUM(CASE WHEN v.date < $2 THEN CASE ve.type WHEN 'Dr' THEN ve.amount ELSE -ve.amount END END), 0) AS before_all,
                COALESCE(SUM(CASE WHEN v.date >= $4 AND v.date < $2 THEN CASE ve.type WHEN 'Dr' THEN ve.amount ELSE -ve.amount END END), 0) AS before_in_fy,
                COALESCE(SUM(CASE WHEN v.date >= $2 AND ve.type = 'Dr' THEN ve.amount END), 0) AS dr,
                COALESCE(SUM(CASE WHEN v.date >= $2 AND ve.type = 'Cr' THEN ve.amount END), 0) AS cr
         FROM ledgers l
         LEFT JOIN ledger_groups g ON g.id = l.group_id
         LEFT JOIN voucher_entries ve ON ve.ledger_id = l.id
         LEFT JOIN vouchers v ON v.id = ve.voucher_id AND v.company_id = $1 AND v.date <= $3
         WHERE l.company_id = $1
         GROUP BY l.id, g.name, g.type
         ORDER BY g.type, g.name, l.name`,
        [companyId, periodStart, to, plStart]
    );

    const { rootCode } = await loadGroups(db, companyId);
    return r.rows.map((row) => {
        const nature = row.group_type as Nature;
        const isPL = nature === 'Income' || nature === 'Expense';
        // P&L ledgers: only this FY's movements before the period; their opening balance
        // field is ignored after the first year (it belongs to retained earnings).
        const opening = isPL ? toPaise(row.before_in_fy) : toPaise(row.ob) + toPaise(row.before_all);
        const debit = toPaise(row.dr);
        const credit = toPaise(row.cr);
        return {
            id: row.id,
            name: row.name,
            code: row.code,
            group_id: row.group_id,
            group_name: row.group_name,
            group_type: nature,
            root_code: rootCode(row.group_id),
            opening,
            debit,
            credit,
            closing: opening + debit - credit,
        };
    });
};

/* ---------------- Trial balance ---------------- */

export const trialBalance = async (companyId: string, from: string, to: string) => {
    const rows = await ledgerBalances(companyId, from, to);
    const report = rows
        .filter((r) => r.opening !== 0 || r.debit !== 0 || r.credit !== 0)
        .map((r) => {
            const open = signedToDrCr(r.opening);
            const close = signedToDrCr(r.closing);
            return {
                id: r.id,
                name: r.name,
                group_name: r.group_name,
                group_type: r.group_type,
                opening_balance: open.amount,
                opening_balance_type: open.type,
                total_debit: fromPaise(r.debit),
                total_credit: fromPaise(r.credit),
                closing_balance: close.amount,
                closing_balance_type: close.type,
            };
        });

    // Unadjusted opening differences (from ledger opening balances) make a TB not tally:
    // surface them instead of hiding them.
    const drTotal = rows.reduce((s, r) => s + Math.max(r.closing, 0), 0);
    const crTotal = rows.reduce((s, r) => s + Math.max(-r.closing, 0), 0);
    return {
        report,
        totals: {
            debit: fromPaise(drTotal),
            credit: fromPaise(crTotal),
            difference: fromPaise(drTotal - crTotal),
        },
    };
};

/* ---------------- Profit & Loss ---------------- */

const TRADING_ROOTS = new Set(['SALES_ACCOUNTS', 'DIRECT_INCOMES', 'PURCHASE_ACCOUNTS', 'DIRECT_EXPENSES']);

export const profitAndLoss = async (companyId: string, from: string, to: string) => {
    const rows = (await ledgerBalances(companyId, from, to)).filter(
        (r) => r.group_type === 'Income' || r.group_type === 'Expense'
    );
    // Period movement only (P&L is a period statement)
    const line = (r: LedgerBalance) => {
        const movement = r.debit - r.credit; // signed, Dr positive
        const balance = r.group_type === 'Income' ? -movement : movement; // natural sign
        return {
            ledger_id: r.id,
            ledger_name: r.name,
            group_name: r.group_name,
            group_type: r.group_type,
            section: r.root_code && TRADING_ROOTS.has(r.root_code) ? 'trading' : 'profit_loss',
            balance: fromPaise(balance),
            balance_type: balance >= 0 ? (r.group_type === 'Income' ? 'Cr' : 'Dr') : r.group_type === 'Income' ? 'Dr' : 'Cr',
            _p: balance,
        };
    };
    const all = rows.map(line).filter((l) => l._p !== 0);

    // Trading account: opening stock is a cost, closing stock reduces it (stock still on hand)
    const openingStock = await stockValuePaise({ query }, companyId, from, { before: true });
    const closingStock = await stockValuePaise({ query }, companyId, to);
    const stockLine = (id: string, name: string, type: 'Income' | 'Expense', p: number) => ({
        ledger_id: id, ledger_name: name, group_name: 'Stock-in-Hand', group_type: type, section: 'trading',
        balance: fromPaise(p), balance_type: type === 'Income' ? 'Cr' : 'Dr', _p: p,
    });
    if (openingStock) all.unshift(stockLine('OPENING_STOCK', 'Opening Stock', 'Expense', openingStock));
    if (closingStock) all.push(stockLine('CLOSING_STOCK', 'Closing Stock', 'Income', closingStock));

    const income = all.filter((l) => l.group_type === 'Income');
    const expenses = all.filter((l) => l.group_type === 'Expense');
    const sum = (xs: typeof all) => xs.reduce((s, l) => s + l._p, 0);

    const grossProfit =
        sum(income.filter((l) => l.section === 'trading')) - sum(expenses.filter((l) => l.section === 'trading'));
    const net = sum(income) - sum(expenses);
    const strip = (xs: typeof all) => xs.map(({ _p, ...rest }) => rest);

    return {
        income: strip(income),
        expenses: strip(expenses),
        totalIncome: fromPaise(sum(income)),
        totalExpenses: fromPaise(sum(expenses)),
        grossProfit: fromPaise(grossProfit),
        netProfit: fromPaise(net),
        netProfitType: net >= 0 ? 'Profit' : 'Loss',
        openingStock: fromPaise(openingStock),
        closingStock: fromPaise(closingStock),
    };
};

/* ---------------- Balance sheet ---------------- */

export const balanceSheet = async (companyId: string, asOf: string) => {
    const fyStart = await fyStartFor({ query }, companyId, asOf);
    const all = await ledgerBalances(companyId, null, asOf);

    // P&L ledgers: total since inception (closing with from = null includes everything)
    const plAll = await query(
        `SELECT
            COALESCE(SUM(CASE WHEN v.date < $3 THEN CASE ve.type WHEN 'Dr' THEN ve.amount ELSE -ve.amount END END), 0) AS prior,
            COALESCE(SUM(CASE WHEN v.date >= $3 THEN CASE ve.type WHEN 'Dr' THEN ve.amount ELSE -ve.amount END END), 0) AS current
         FROM voucher_entries ve
         JOIN vouchers v ON v.id = ve.voucher_id
         JOIN ledgers l ON l.id = ve.ledger_id
         JOIN ledger_groups g ON g.id = l.group_id
         WHERE v.company_id = $1 AND v.date <= $2 AND g.type IN ('Income', 'Expense')`,
        [companyId, asOf, fyStart]
    );
    // Stock: what is on hand is an asset; its change over time is part of profit
    const booksOpeningStock = await openingStockPaise({ query }, companyId);
    const stockAtYearStart = await stockValuePaise({ query }, companyId, fyStart, { before: true });
    const closingStock = await stockValuePaise({ query }, companyId, asOf);

    // Profit is a credit (negative signed), so negate
    const priorProfit = -toPaise(plAll.rows[0].prior) + stockAtYearStart - booksOpeningStock;
    const currentProfit = -toPaise(plAll.rows[0].current) + closingStock - stockAtYearStart;

    // Opening balances of P&L ledgers (rare) are treated as prior-year profit
    const plLedgerOpenings = await query(
        `SELECT COALESCE(SUM(CASE WHEN l.opening_balance_type = 'Cr' THEN -l.opening_balance ELSE l.opening_balance END), 0) AS ob
         FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id
         WHERE l.company_id = $1 AND g.type IN ('Income', 'Expense')`,
        [companyId]
    );
    const retained = priorProfit - toPaise(plLedgerOpenings.rows[0].ob);

    const bsRows = all.filter((r) => (r.group_type === 'Asset' || r.group_type === 'Liability') && r.closing !== 0);
    const toLine = (r: LedgerBalance) => {
        const natural = r.group_type === 'Asset' ? r.closing : -r.closing;
        return {
            ledger_id: r.id,
            ledger_name: r.name,
            group_name: r.group_name,
            group_type: r.group_type,
            balance: fromPaise(natural),
            balance_type: r.closing >= 0 ? 'Dr' : 'Cr',
            _p: natural,
        };
    };
    const assets = bsRows.filter((r) => r.group_type === 'Asset').map(toLine);
    if (closingStock) {
        assets.push({
            ledger_id: 'CLOSING_STOCK', ledger_name: 'Closing Stock', group_name: 'Stock-in-Hand', group_type: 'Asset',
            balance: fromPaise(closingStock), balance_type: 'Dr', _p: closingStock,
        });
    }
    const liabilities = bsRows.filter((r) => r.group_type === 'Liability').map(toLine);

    const plTotal = retained + currentProfit;
    if (plTotal !== 0 || currentProfit !== 0) {
        liabilities.push({
            ledger_id: 'PROFIT_AND_LOSS',
            ledger_name: 'Profit & Loss A/c',
            group_name: 'Profit & Loss A/c',
            group_type: 'Liability',
            balance: fromPaise(plTotal),
            balance_type: plTotal >= 0 ? 'Cr' : 'Dr',
            _p: plTotal,
        });
    }

    const sum = (xs: { _p: number }[]) => xs.reduce((s, l) => s + l._p, 0);
    // Σ of all ledger opening balances should be zero; any remainder is shown like Tally does.
    const openingDiff = sum(assets) - sum(liabilities);
    if (openingDiff !== 0) {
        liabilities.push({
            ledger_id: 'OPENING_DIFFERENCE',
            ledger_name: 'Difference in opening balances',
            group_name: 'Difference in opening balances',
            group_type: 'Liability',
            balance: fromPaise(openingDiff),
            balance_type: openingDiff >= 0 ? 'Cr' : 'Dr',
            _p: openingDiff,
        });
    }

    const strip = (xs: any[]) => xs.map(({ _p, ...rest }) => rest);
    return {
        assets: strip(assets),
        liabilities: strip(liabilities),
        totalAssets: fromPaise(sum(assets)),
        totalLiabilities: fromPaise(sum(liabilities)),
        difference: fromPaise(sum(assets) - sum(liabilities)),
        openingDifference: fromPaise(openingDiff),
        profit: { previousYears: fromPaise(retained), currentYear: fromPaise(currentProfit) },
    };
};

/* ---------------- Ledger statement ---------------- */

export const ledgerStatement = async (companyId: string, ledgerId: string, from?: string | null, to?: string | null) => {
    const end = to || toDateString(new Date());
    const start = from || (await fyStartFor({ query }, companyId, end));
    const [bal] = (await ledgerBalances(companyId, start, end)).filter((r) => r.id === ledgerId);
    if (!bal) return null;

    const txns = await query(
        `SELECT ve.id, ve.amount, ve.type, ve.instrument_number, v.id AS voucher_id, v.voucher_number, v.date,
                v.narration, vt.name AS voucher_type_name,
                (SELECT i.id FROM invoices i WHERE i.voucher_id = v.id LIMIT 1) AS invoice_id,
                (SELECT string_agg(DISTINCT l2.name, ', ') FROM voucher_entries ve2
                   JOIN ledgers l2 ON l2.id = ve2.ledger_id
                   WHERE ve2.voucher_id = v.id AND ve2.ledger_id <> ve.ledger_id) AS particulars
         FROM voucher_entries ve
         JOIN vouchers v ON v.id = ve.voucher_id
         LEFT JOIN voucher_types vt ON vt.id = v.voucher_type_id
         WHERE ve.ledger_id = $1 AND v.company_id = $2 AND v.date BETWEEN $3 AND $4
         ORDER BY v.date, v.created_at, ve.created_at`,
        [ledgerId, companyId, start, end]
    );

    let running = bal.opening;
    const transactions = txns.rows.map((t) => {
        const p = toPaise(t.amount);
        running += t.type === 'Dr' ? p : -p;
        const b = signedToDrCr(running);
        return {
            ...t,
            debit: t.type === 'Dr' ? fromPaise(p) : 0,
            credit: t.type === 'Cr' ? fromPaise(p) : 0,
            balance: b.amount,
            balance_type: b.type,
        };
    });

    const open = signedToDrCr(bal.opening);
    const close = signedToDrCr(running);
    return {
        ledger: {
            id: bal.id,
            name: bal.name,
            group_name: bal.group_name,
            group_type: bal.group_type,
            opening_balance: open.amount,
            opening_balance_type: open.type,
            total_debit: fromPaise(bal.debit),
            total_credit: fromPaise(bal.credit),
            closing_balance: close.amount,
            closing_balance_type: close.type,
        },
        period: { from: start, to: end },
        transactions,
    };
};
