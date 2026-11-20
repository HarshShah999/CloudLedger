import { query } from '../config/db';
import { fromPaise, toPaise } from '../utils/money';
import { ledgerBalances } from './reportService';

export type AgeingKind = 'receivable' | 'payable';

const DOCS: Record<AgeingKind, { due: string[]; credit: string[]; advance: 'RECEIPT' | 'PAYMENT' }> = {
    // Customers owe us for sales; credit notes (sales returns) and advances reduce that
    receivable: { due: ['SALES'], credit: ['CREDIT_NOTE'], advance: 'RECEIPT' },
    // We owe suppliers for purchases; debit notes (purchase returns) and advances reduce that
    payable: { due: ['PURCHASE'], credit: ['DEBIT_NOTE'], advance: 'PAYMENT' },
};

export const BUCKETS = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type Bucket = (typeof BUCKETS)[number];

export const bucketFor = (daysOverdue: number): Bucket =>
    daysOverdue <= 0 ? 'not_due' : daysOverdue <= 30 ? 'd1_30' : daysOverdue <= 60 ? 'd31_60' : daysOverdue <= 90 ? 'd61_90' : 'd90_plus';

const daysBetween = (from: string, to: string) =>
    Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000);

/**
 * Bill-wise outstanding with ageing by due date, as on `asOf`.
 * Only bills dated on or before `asOf` and payments up to `asOf` are counted.
 */
export const ageing = async (companyId: string, kind: AgeingKind, asOf: string) => {
    const cfg = DOCS[kind];
    const docs = (
        await query(
            `SELECT i.id, i.invoice_number, i.type, i.date, i.due_date, i.grand_total - i.tds_amount AS grand_total, i.party_ledger_id,
                    l.name AS party_name, l.phone AS party_phone,
                    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.payment_date <= $3), 0) AS paid
             FROM invoices i JOIN ledgers l ON l.id = i.party_ledger_id
             WHERE i.company_id = $1 AND i.type = ANY($2) AND i.date <= $3 AND COALESCE(i.status, '') <> 'CANCELLED'`,
            [companyId, [...cfg.due, ...cfg.credit], asOf]
        )
    ).rows;

    const advances = (
        await query(
            `SELECT r.party_ledger_id, l.name AS party_name, l.phone AS party_phone,
                    SUM(r.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.receipt_id = r.id AND p.payment_date <= $3), 0)) AS unallocated
             FROM receipts r JOIN ledgers l ON l.id = r.party_ledger_id
             WHERE r.company_id = $1 AND r.direction = $2 AND r.date <= $3
             GROUP BY r.party_ledger_id, l.name, l.phone`,
            [companyId, cfg.advance, asOf]
        )
    ).rows;

    type Party = {
        ledger_id: string;
        name: string;
        phone: string | null;
        buckets: Record<Bucket, number>;
        due: number;
        credits: number;
        oldest_days: number;
    };
    const parties = new Map<string, Party>();
    const party = (id: string, name: string, phone: string | null) => {
        if (!parties.has(id)) {
            parties.set(id, {
                ledger_id: id, name, phone,
                buckets: { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
                due: 0, credits: 0, oldest_days: 0,
            });
        }
        return parties.get(id)!;
    };

    const bills: any[] = [];
    for (const d of docs) {
        const outstandingP = toPaise(d.grand_total) - toPaise(d.paid);
        if (outstandingP <= 0) continue;
        const p = party(d.party_ledger_id, d.party_name, d.party_phone);
        if (cfg.credit.includes(d.type)) {
            p.credits += outstandingP;
            continue;
        }
        const overdue = daysBetween(String(d.due_date || d.date).slice(0, 10), asOf);
        const b = bucketFor(overdue);
        p.buckets[b] += outstandingP;
        p.due += outstandingP;
        p.oldest_days = Math.max(p.oldest_days, overdue);
        bills.push({
            id: d.id, invoice_number: d.invoice_number, type: d.type, date: d.date, due_date: d.due_date,
            party_ledger_id: d.party_ledger_id, party_name: d.party_name,
            grand_total: Number(d.grand_total), outstanding: fromPaise(outstandingP), days_overdue: overdue, bucket: b,
        });
    }
    for (const a of advances) {
        const u = toPaise(a.unallocated);
        if (u > 0) party(a.party_ledger_id, a.party_name, a.party_phone).credits += u;
    }

    // Ledger balance as a cross-check (journal entries to a party are not bill-wise)
    const balances = new Map((await ledgerBalances(companyId, null, asOf)).map((l) => [l.id, l.closing]));

    const rows = [...parties.values()]
        .map((p) => {
            const net = p.due - p.credits;
            const bal = balances.get(p.ledger_id) ?? 0;
            return {
                ledger_id: p.ledger_id,
                name: p.name,
                phone: p.phone,
                buckets: Object.fromEntries(BUCKETS.map((b) => [b, fromPaise(p.buckets[b])])) as Record<Bucket, number>,
                total_due: fromPaise(p.due),
                credits: fromPaise(p.credits),
                net: fromPaise(net),
                oldest_days: p.oldest_days,
                ledger_balance: fromPaise(kind === 'receivable' ? bal : -bal),
            };
        })
        .filter((r) => r.total_due !== 0 || r.credits !== 0)
        .sort((a, b) => b.net - a.net);

    const totals = Object.fromEntries(
        BUCKETS.map((b) => [b, fromPaise(rows.reduce((s, r) => s + toPaise(r.buckets[b]), 0))])
    ) as Record<Bucket, number>;
    return {
        kind,
        asOf,
        parties: rows,
        bills: bills.sort((a, b) => b.days_overdue - a.days_overdue),
        totals: {
            ...totals,
            total_due: fromPaise(rows.reduce((s, r) => s + toPaise(r.total_due), 0)),
            credits: fromPaise(rows.reduce((s, r) => s + toPaise(r.credits), 0)),
            net: fromPaise(rows.reduce((s, r) => s + toPaise(r.net), 0)),
        },
    };
};

/** All vouchers in a period with their Dr/Cr lines (Tally's Day Book). */
export const dayBook = async (companyId: string, from: string, to: string, voucherTypeId?: string) => {
    const params: any[] = [companyId, from, to];
    let extra = '';
    if (voucherTypeId) {
        params.push(voucherTypeId);
        extra = ' AND v.voucher_type_id = $4';
    }
    const r = await query(
        `SELECT v.id, v.date, v.voucher_number, v.narration, v.total_amount, vt.name AS voucher_type,
                (SELECT i.id FROM invoices i WHERE i.voucher_id = v.id LIMIT 1) AS invoice_id,
                json_agg(json_build_object('ledger_id', l.id, 'ledger', l.name, 'type', ve.type, 'amount', ve.amount)
                         ORDER BY CASE ve.type WHEN 'Dr' THEN 0 ELSE 1 END, ve.created_at) AS entries
         FROM vouchers v
         LEFT JOIN voucher_types vt ON vt.id = v.voucher_type_id
         JOIN voucher_entries ve ON ve.voucher_id = v.id
         JOIN ledgers l ON l.id = ve.ledger_id
         WHERE v.company_id = $1 AND v.date BETWEEN $2 AND $3${extra}
         GROUP BY v.id, vt.name
         ORDER BY v.date, v.created_at`,
        params
    );
    const vouchers = r.rows.map((v) => ({
        ...v,
        total_amount: Number(v.total_amount),
        entries: v.entries.map((e: any) => ({ ...e, amount: Number(e.amount) })),
    }));
    return {
        period: { from, to },
        vouchers,
        total: fromPaise(vouchers.reduce((s, v) => s + toPaise(v.total_amount), 0)),
    };
};
