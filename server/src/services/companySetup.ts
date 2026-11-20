import { Queryable } from '../config/db';

export type GroupType = 'Asset' | 'Liability' | 'Income' | 'Expense';

interface GroupDef {
    code: string;
    name: string;
    type: GroupType;
    parent?: string;
}

/**
 * Standard Indian chart of accounts (Tally-style primary groups).
 * `code` lets the posting engine find groups without guessing by name.
 */
export const STANDARD_GROUPS: GroupDef[] = [
    // Assets
    { code: 'CURRENT_ASSETS', name: 'Current Assets', type: 'Asset' },
    { code: 'FIXED_ASSETS', name: 'Fixed Assets', type: 'Asset' },
    { code: 'INVESTMENTS', name: 'Investments', type: 'Asset' },
    { code: 'BANK_ACCOUNTS', name: 'Bank Accounts', type: 'Asset', parent: 'CURRENT_ASSETS' },
    { code: 'CASH_IN_HAND', name: 'Cash-in-Hand', type: 'Asset', parent: 'CURRENT_ASSETS' },
    { code: 'SUNDRY_DEBTORS', name: 'Sundry Debtors', type: 'Asset', parent: 'CURRENT_ASSETS' },
    { code: 'STOCK_IN_HAND', name: 'Stock-in-Hand', type: 'Asset', parent: 'CURRENT_ASSETS' },
    { code: 'LOANS_ADVANCES_ASSET', name: 'Loans & Advances (Asset)', type: 'Asset', parent: 'CURRENT_ASSETS' },
    { code: 'DEPOSITS_ASSET', name: 'Deposits (Asset)', type: 'Asset', parent: 'CURRENT_ASSETS' },
    // Liabilities
    { code: 'CAPITAL', name: 'Capital Account', type: 'Liability' },
    { code: 'RESERVES', name: 'Reserves & Surplus', type: 'Liability', parent: 'CAPITAL' },
    { code: 'LOANS_LIABILITY', name: 'Loans (Liability)', type: 'Liability' },
    { code: 'SECURED_LOANS', name: 'Secured Loans', type: 'Liability', parent: 'LOANS_LIABILITY' },
    { code: 'UNSECURED_LOANS', name: 'Unsecured Loans', type: 'Liability', parent: 'LOANS_LIABILITY' },
    { code: 'BANK_OD', name: 'Bank OD A/c', type: 'Liability', parent: 'LOANS_LIABILITY' },
    { code: 'CURRENT_LIABILITIES', name: 'Current Liabilities', type: 'Liability' },
    { code: 'DUTIES_TAXES', name: 'Duties & Taxes', type: 'Liability', parent: 'CURRENT_LIABILITIES' },
    { code: 'SUNDRY_CREDITORS', name: 'Sundry Creditors', type: 'Liability', parent: 'CURRENT_LIABILITIES' },
    { code: 'PROVISIONS', name: 'Provisions', type: 'Liability', parent: 'CURRENT_LIABILITIES' },
    // Income
    { code: 'SALES_ACCOUNTS', name: 'Sales Accounts', type: 'Income' },
    { code: 'DIRECT_INCOMES', name: 'Direct Incomes', type: 'Income' },
    { code: 'INDIRECT_INCOMES', name: 'Indirect Incomes', type: 'Income' },
    // Expenses
    { code: 'PURCHASE_ACCOUNTS', name: 'Purchase Accounts', type: 'Expense' },
    { code: 'DIRECT_EXPENSES', name: 'Direct Expenses', type: 'Expense' },
    { code: 'INDIRECT_EXPENSES', name: 'Indirect Expenses', type: 'Expense' },
];

interface LedgerDef {
    code: string;
    name: string;
    group: string;
}

/** Ledgers the system posts to automatically. Created on demand if missing. */
export const SYSTEM_LEDGERS: LedgerDef[] = [
    { code: 'CASH', name: 'Cash', group: 'CASH_IN_HAND' },
    { code: 'SALES', name: 'Sales', group: 'SALES_ACCOUNTS' },
    { code: 'PURCHASE', name: 'Purchase', group: 'PURCHASE_ACCOUNTS' },
    { code: 'CAPITAL', name: "Proprietor's Capital", group: 'CAPITAL' },
    { code: 'OUTPUT_CGST', name: 'Output CGST', group: 'DUTIES_TAXES' },
    { code: 'OUTPUT_SGST', name: 'Output SGST', group: 'DUTIES_TAXES' },
    { code: 'OUTPUT_IGST', name: 'Output IGST', group: 'DUTIES_TAXES' },
    { code: 'INPUT_CGST', name: 'Input CGST', group: 'DUTIES_TAXES' },
    { code: 'INPUT_SGST', name: 'Input SGST', group: 'DUTIES_TAXES' },
    { code: 'INPUT_IGST', name: 'Input IGST', group: 'DUTIES_TAXES' },
    { code: 'ROUND_OFF', name: 'Round Off', group: 'INDIRECT_EXPENSES' },
    { code: 'RCM_CGST', name: 'CGST Payable (Reverse Charge)', group: 'DUTIES_TAXES' },
    { code: 'RCM_SGST', name: 'SGST Payable (Reverse Charge)', group: 'DUTIES_TAXES' },
    { code: 'RCM_IGST', name: 'IGST Payable (Reverse Charge)', group: 'DUTIES_TAXES' },
    { code: 'TDS_PAYABLE', name: 'TDS Payable', group: 'DUTIES_TAXES' },
];

export const STANDARD_VOUCHER_TYPES = [
    'Sales',
    'Purchase',
    'Payment',
    'Receipt',
    'Journal',
    'Contra',
    'Credit Note',
    'Debit Note',
];

/** Finds (or creates) the group with the given system code. Returns its id. */
export const ensureSystemGroup = async (db: Queryable, companyId: string, code: string): Promise<string> => {
    const existing = await db.query('SELECT id FROM ledger_groups WHERE company_id = $1 AND code = $2', [companyId, code]);
    if (existing.rows.length) return existing.rows[0].id;

    const def = STANDARD_GROUPS.find((g) => g.code === code);
    if (!def) throw new Error(`Unknown system group ${code}`);
    const parentId = def.parent ? await ensureSystemGroup(db, companyId, def.parent) : null;

    // Adopt a same-named group created before system codes existed
    const byName = await db.query(
        'SELECT id FROM ledger_groups WHERE company_id = $1 AND lower(name) = lower($2) AND code IS NULL LIMIT 1',
        [companyId, def.name]
    );
    if (byName.rows.length) {
        await db.query('UPDATE ledger_groups SET code = $1 WHERE id = $2', [code, byName.rows[0].id]);
        return byName.rows[0].id;
    }

    const created = await db.query(
        'INSERT INTO ledger_groups (company_id, name, type, parent_id, code) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [companyId, def.name, def.type, parentId, code]
    );
    return created.rows[0].id;
};

/** Finds (or creates) the ledger with the given system code. Returns its id. */
export const ensureSystemLedger = async (db: Queryable, companyId: string, code: string): Promise<string> => {
    const existing = await db.query('SELECT id FROM ledgers WHERE company_id = $1 AND code = $2', [companyId, code]);
    if (existing.rows.length) return existing.rows[0].id;

    const def = SYSTEM_LEDGERS.find((l) => l.code === code);
    if (!def) throw new Error(`Unknown system ledger ${code}`);

    const byName = await db.query(
        'SELECT id FROM ledgers WHERE company_id = $1 AND lower(name) = lower($2) AND code IS NULL LIMIT 1',
        [companyId, def.name]
    );
    if (byName.rows.length) {
        await db.query('UPDATE ledgers SET code = $1 WHERE id = $2', [code, byName.rows[0].id]);
        return byName.rows[0].id;
    }

    const groupId = await ensureSystemGroup(db, companyId, def.group);
    const created = await db.query(
        `INSERT INTO ledgers (company_id, group_id, name, opening_balance, opening_balance_type, code)
         VALUES ($1, $2, $3, 0, 'Dr', $4) RETURNING id`,
        [companyId, groupId, def.name, code]
    );
    return created.rows[0].id;
};

export const ensureVoucherType = async (db: Queryable, companyId: string, name: string): Promise<string> => {
    const r = await db.query('SELECT id FROM voucher_types WHERE company_id = $1 AND name = $2 LIMIT 1', [companyId, name]);
    if (r.rows.length) return r.rows[0].id;
    const c = await db.query('INSERT INTO voucher_types (company_id, name) VALUES ($1, $2) RETURNING id', [companyId, name]);
    return c.rows[0].id;
};

/** Seeds a brand-new company with groups, system ledgers and voucher types. */
export const seedCompany = async (db: Queryable, companyId: string) => {
    for (const g of STANDARD_GROUPS) await ensureSystemGroup(db, companyId, g.code);
    for (const l of SYSTEM_LEDGERS) await ensureSystemLedger(db, companyId, l.code);
    for (const v of STANDARD_VOUCHER_TYPES) await ensureVoucherType(db, companyId, v);
};
