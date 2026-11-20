/** Reading the audit trail (the log itself is written by database triggers). */
import { query } from '../config/db';
import { isUuid } from '../middleware/companyAccess';

const TABLE_LABELS: Record<string, string> = {
    companies: 'Company',
    company_users: 'User access',
    financial_years: 'Financial year',
    ledger_groups: 'Group',
    ledgers: 'Ledger',
    voucher_types: 'Voucher type',
    vouchers: 'Voucher',
    voucher_entries: 'Voucher entry',
    invoices: 'Invoice',
    invoice_items: 'Invoice line',
    payments: 'Payment',
    items: 'Item',
    units: 'Unit',
    recurring_invoices: 'Recurring invoice',
    number_series: 'Number series',
};

/** Line items and series counters are noise in the main log; they show up in document history. */
const DETAIL_TABLES = ['voucher_entries', 'invoice_items', 'number_series'];

const describe = (row: any) => {
    const d = row.new_data || row.old_data || {};
    const label =
        d.invoice_number ||
        d.voucher_number ||
        d.name ||
        d.description ||
        (d.amount ? `₹${Number(d.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '') ||
        '';
    return {
        id: Number(row.id),
        txid: String(row.txid),
        table: row.table_name,
        entity: TABLE_LABELS[row.table_name] || row.table_name,
        label,
        recordId: row.record_id,
        action: row.action,
        changedFields: row.changed_fields,
        oldData: row.old_data,
        newData: row.new_data,
        user: row.user_name || (row.user_id ? 'Deleted user' : 'System'),
        ip: row.ip_address,
        at: row.created_at,
    };
};

export interface AuditFilters { table?: string; includeDetails?: string; action?: string; userId?: string; from?: string; to?: string; before?: string; limit?: string }

/** The company's edit log, newest first, with filters and cursor paging. */
export const auditLog = async (companyId: string, q: AuditFilters) => {
    const params: any[] = [companyId];
    const where = ['a.company_id = $1'];
    const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replace('?', `$${params.length}`));
    };
    
    if (q.table) add('a.table_name = ?', String(q.table));
    else if (q.includeDetails !== 'true') add('NOT (a.table_name = ANY(?))', DETAIL_TABLES);
    if (q.action) add('a.action = ?', String(q.action).toUpperCase());
    if (q.userId && isUuid(q.userId)) add('a.user_id = ?', q.userId);
    if (q.from) add('a.created_at >= ?::date', String(q.from).slice(0, 10));
    if (q.to) add("a.created_at < (?::date + interval '1 day')", String(q.to).slice(0, 10));
    if (q.before) add('a.id < ?', Number(q.before));
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);

    const r = await query(
        `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ${limit + 1}`,
        params
    );
    const rows = r.rows.slice(0, limit).map(describe);
    return { entries: rows, nextCursor: r.rows.length > limit ? rows[rows.length - 1].id : null };
};

/** Every change to one document, grouped by save (transaction). */
export const recordHistory = async (companyId: string, recordId: string) => {
    const r = await query(
        `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.company_id = $1
           AND a.txid IN (SELECT txid FROM audit_log WHERE company_id = $1 AND record_id = $2)
           AND a.table_name <> 'number_series'
         ORDER BY a.id`,
        [companyId, recordId]
    );
    const groups = new Map<string, { txid: string; at: string; user: string; changes: ReturnType<typeof describe>[] }>();
    for (const row of r.rows) {
        const e = describe(row);
        if (!groups.has(e.txid)) groups.set(e.txid, { txid: e.txid, at: e.at, user: e.user, changes: [] });
        groups.get(e.txid)!.changes.push(e);
    }
    return [...groups.values()].reverse();
};
