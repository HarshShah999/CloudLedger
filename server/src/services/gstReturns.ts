import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { fromPaise, toPaise } from '../utils/money';
import { stateCode, uqcFor, isWithoutPayment } from '../utils/gst';

/** B2C (Large): unregistered, inter-state, invoice value above ₹1,00,000 (limit since 1 Aug 2024). */
export const B2CL_LIMIT = 100000;

const r2 = (paise: number) => fromPaise(Math.round(paise));
const ddmmyyyy = (d: string) => {
    const [y, m, day] = String(d).slice(0, 10).split('-');
    return `${day}-${m}-${y}`;
};

interface DocRow {
    id: string;
    type: string;
    invoice_number: string;
    date: string;
    grand_total: string;
    supply_type: string;
    reverse_charge: boolean;
    place_of_supply: string | null;
    original_invoice_number: string | null;
    original_invoice_date: string | null;
    shipping_bill_number: string | null;
    shipping_bill_date: string | null;
    port_code: string | null;
    party_gstin: string | null;
    party_name: string;
    party_state: string | null;
    company_state: string | null;
    items: {
        taxable_amount: string; tax_rate: string; igst_amount: string; cgst_amount: string; sgst_amount: string;
        hsn_code: string | null; item_name: string | null; description: string | null; quantity: string;
        uqc: string | null; unit_symbol: string | null; item_type: string | null;
    }[];
}

const loadDocs = async (companyId: string, from: string, to: string, types: string[]): Promise<DocRow[]> =>
    (
        await query(
            `SELECT i.id, i.type, i.invoice_number, i.date, i.grand_total, i.supply_type, i.reverse_charge,
                    COALESCE(i.place_of_supply, l.state) AS place_of_supply, i.original_invoice_number, i.original_invoice_date,
                    i.shipping_bill_number, i.shipping_bill_date, i.port_code,
                    l.gstin AS party_gstin, l.name AS party_name, l.state AS party_state, c.state AS company_state,
                    COALESCE((SELECT json_agg(json_build_object(
                        'taxable_amount', ii.taxable_amount, 'tax_rate', ii.tax_rate, 'igst_amount', ii.igst_amount,
                        'cgst_amount', ii.cgst_amount, 'sgst_amount', ii.sgst_amount, 'hsn_code', it.hsn_code,
                        'item_name', it.name, 'description', ii.description, 'quantity', ii.quantity,
                        'uqc', u.uqc, 'unit_symbol', u.symbol, 'item_type', it.item_type))
                      FROM invoice_items ii
                      LEFT JOIN items it ON it.id = ii.item_id
                      LEFT JOIN units u ON u.id = it.unit_id
                      WHERE ii.invoice_id = i.id), '[]') AS items
             FROM invoices i
             JOIN ledgers l ON l.id = i.party_ledger_id
             JOIN companies c ON c.id = i.company_id
             WHERE i.company_id = $1 AND i.type = ANY($2) AND i.date BETWEEN $3 AND $4 AND NOT i.is_opening AND COALESCE(i.status, '') <> 'CANCELLED'
             ORDER BY i.date, i.invoice_number`,
            [companyId, types, from, to]
        )
    ).rows;

/** Line items grouped by tax rate, as GSTN expects (`itms`). Amounts in paise. */
const byRate = (doc: DocRow) => {
    const m = new Map<number, { txval: number; iamt: number; camt: number; samt: number }>();
    for (const it of doc.items) {
        const rt = Number(it.tax_rate);
        const g = m.get(rt) ?? { txval: 0, iamt: 0, camt: 0, samt: 0 };
        g.txval += toPaise(it.taxable_amount);
        g.iamt += toPaise(it.igst_amount);
        g.camt += toPaise(it.cgst_amount);
        g.samt += toPaise(it.sgst_amount);
        m.set(rt, g);
    }
    return [...m.entries()].map(([rt, g]) => ({ rt, ...g }));
};

const itms = (doc: DocRow, igstOnly = false) =>
    byRate(doc).map((g, idx) => ({
        num: idx + 1,
        itm_det: igstOnly
            ? { txval: r2(g.txval), rt: g.rt, iamt: r2(g.iamt), csamt: 0 }
            : { txval: r2(g.txval), rt: g.rt, iamt: r2(g.iamt), camt: r2(g.camt), samt: r2(g.samt), csamt: 0 },
    }));

const isInter = (d: DocRow) => {
    const a = stateCode(d.company_state);
    const b = stateCode(d.place_of_supply);
    return d.supply_type !== 'NORMAL' && d.supply_type !== 'DEEMED_EXPORT' ? true : !!a && !!b && a !== b;
};

const INV_TYP: Record<string, string> = { SEZ_WPAY: 'SEWP', SEZ_WOPAY: 'SEWOP', DEEMED_EXPORT: 'DE' };

/** "032025" from a period's end date */
export const returnPeriod = (to: string) => `${to.slice(5, 7)}${to.slice(0, 4)}`;

/**
 * GSTR-1 in the GST portal / offline tool JSON format, plus a summary for the UI.
 * Sections: b2b, b2cl, b2cs, cdnr, cdnur, exp, hsn (B2B / B2C split), doc_issue.
 */
export const buildGstr1 = async (companyId: string, from: string, to: string) => {
    const company = (await query('SELECT gstin, state FROM companies WHERE id = $1', [companyId])).rows[0];
    if (!company?.gstin) throw new AppError('Add your GSTIN in Settings before preparing GSTR-1', 400);
    // In this app a Debit Note is a purchase return (it reverses ITC); only sales and
    // credit notes issued to customers are outward supplies for GSTR-1.
    const docs = await loadDocs(companyId, from, to, ['SALES', 'CREDIT_NOTE']);

    const b2b = new Map<string, any[]>();
    const b2cl = new Map<string, any[]>();
    const b2cs = new Map<string, { sply_ty: string; pos: string; rt: number; txval: number; iamt: number; camt: number; samt: number }>();
    const cdnr = new Map<string, any[]>();
    const cdnur: any[] = [];
    const exp = new Map<string, any[]>();
    const hsnB2B = new Map<string, any>();
    const hsnB2C = new Map<string, any>();
    const warnings: string[] = [];

    const addB2cs = (d: DocRow, sign: 1 | -1) => {
        const pos = stateCode(d.place_of_supply) || stateCode(d.company_state) || '';
        const sply = isInter(d) ? 'INTER' : 'INTRA';
        for (const g of byRate(d)) {
            const key = `${sply}|${pos}|${g.rt}`;
            const row = b2cs.get(key) ?? { sply_ty: sply, pos, rt: g.rt, txval: 0, iamt: 0, camt: 0, samt: 0 };
            row.txval += sign * g.txval;
            row.iamt += sign * g.iamt;
            row.camt += sign * g.camt;
            row.samt += sign * g.samt;
            b2cs.set(key, row);
        }
    };

    const addHsn = (d: DocRow, sign: 1 | -1) => {
        const target = d.party_gstin ? hsnB2B : hsnB2C;
        for (const it of d.items) {
            const hsn = (it.hsn_code || '').trim();
            if (!hsn) warnings.push(`${d.invoice_number}: a line has no HSN/SAC code`);
            const uqc = it.item_type === 'SERVICES' ? 'NA' : uqcFor(it.uqc, it.unit_symbol);
            const rt = Number(it.tax_rate);
            const key = `${hsn}|${uqc}|${rt}`;
            const row = target.get(key) ?? { hsn_sc: hsn, desc: (it.item_name || it.description || '').slice(0, 30), uqc, rt, qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0 };
            row.qty += sign * Number(it.quantity) * (uqc === 'NA' ? 0 : 1);
            row.txval += sign * toPaise(it.taxable_amount);
            row.iamt += sign * toPaise(it.igst_amount);
            row.camt += sign * toPaise(it.cgst_amount);
            row.samt += sign * toPaise(it.sgst_amount);
            target.set(key, row);
        }
    };

    for (const d of docs) {
        const pos = stateCode(d.place_of_supply);
        if (!pos && !d.supply_type.startsWith('EXPORT')) warnings.push(`${d.invoice_number}: place of supply is missing`);
        const val = Number(d.grand_total);
        const rchrg = d.reverse_charge ? 'Y' : 'N';

        if (d.type === 'SALES') {
            addHsn(d, 1);
            if (d.supply_type.startsWith('EXPORT')) {
                const typ = isWithoutPayment(d.supply_type) ? 'WOPAY' : 'WPAY';
                const list = exp.get(typ) ?? [];
                list.push({
                    inum: d.invoice_number, idt: ddmmyyyy(d.date), val,
                    ...(d.port_code ? { sbpcode: d.port_code } : {}),
                    ...(d.shipping_bill_number ? { sbnum: d.shipping_bill_number } : {}),
                    ...(d.shipping_bill_date ? { sbdt: ddmmyyyy(d.shipping_bill_date) } : {}),
                    itms: byRate(d).map((g) => ({ txval: r2(g.txval), rt: g.rt, iamt: r2(g.iamt), csamt: 0 })),
                });
                exp.set(typ, list);
            } else if (d.party_gstin) {
                const list = b2b.get(d.party_gstin) ?? [];
                list.push({ inum: d.invoice_number, idt: ddmmyyyy(d.date), val, pos, rchrg, inv_typ: INV_TYP[d.supply_type] || 'R', itms: itms(d) });
                b2b.set(d.party_gstin, list);
            } else if (isInter(d) && val > B2CL_LIMIT) {
                const list = b2cl.get(pos || '') ?? [];
                list.push({ inum: d.invoice_number, idt: ddmmyyyy(d.date), val, itms: itms(d, true) });
                b2cl.set(pos || '', list);
            } else {
                addB2cs(d, 1);
            }
            continue;
        }

        // Credit notes (sales returns / reductions)
        const ntty = 'C';
        const sign = -1;
        addHsn(d, sign);
        const note = { ntty, nt_num: d.invoice_number, nt_dt: ddmmyyyy(d.date), val, pos, rchrg };
        if (d.party_gstin) {
            const list = cdnr.get(d.party_gstin) ?? [];
            list.push({ ...note, inv_typ: INV_TYP[d.supply_type] || 'R', itms: itms(d) });
            cdnr.set(d.party_gstin, list);
        } else if (d.supply_type.startsWith('EXPORT')) {
            cdnur.push({ typ: isWithoutPayment(d.supply_type) ? 'EXPWOP' : 'EXPWP', ...note, itms: itms(d, true) });
        } else if (isInter(d) && val > B2CL_LIMIT) {
            cdnur.push({ typ: 'B2CL', ...note, itms: itms(d, true) });
        } else {
            // Notes to small unregistered buyers are reported by adjusting B2CS
            addB2cs(d, sign);
        }
    }

    const hsnList = (m: Map<string, any>) =>
        [...m.values()].map((h, i) => ({
            num: i + 1, hsn_sc: h.hsn_sc, desc: h.desc, uqc: h.uqc, qty: Math.round(h.qty * 1000) / 1000, rt: h.rt,
            txval: r2(h.txval), iamt: r2(h.iamt), camt: r2(h.camt), samt: r2(h.samt), csamt: 0,
        }));

    // Table 13: documents issued, including cancelled ones (the series must be complete)
    const cancelled = (
        await query(
            `SELECT type, invoice_number, date FROM invoices
             WHERE company_id = $1 AND type IN ('SALES', 'CREDIT_NOTE') AND status = 'CANCELLED' AND date BETWEEN $2 AND $3`,
            [companyId, from, to]
        )
    ).rows;
    const docIssue = (type: string, docNum: number) => {
        const all = [
            ...docs.filter((d) => d.type === type).map((d) => ({ n: d.invoice_number, d: String(d.date).slice(0, 10) })),
            ...cancelled.filter((c) => c.type === type).map((c) => ({ n: c.invoice_number, d: String(c.date).slice(0, 10) })),
        ].sort((a, b) => a.d.localeCompare(b.d) || a.n.localeCompare(b.n, undefined, { numeric: true }));
        if (!all.length) return null;
        const cancel = cancelled.filter((c) => c.type === type).length;
        return { doc_num: docNum, docs: [{ num: 1, from: all[0].n, to: all[all.length - 1].n, totnum: all.length, cancel, net_issue: all.length - cancel }] };
    };

    const json: Record<string, unknown> = { gstin: company.gstin, fp: returnPeriod(to) };
    if (b2b.size) json.b2b = [...b2b.entries()].map(([ctin, inv]) => ({ ctin, inv }));
    if (b2cl.size) json.b2cl = [...b2cl.entries()].map(([pos, inv]) => ({ pos, inv }));
    const b2csRows = [...b2cs.values()].filter((r) => r.txval !== 0);
    if (b2csRows.length) {
        json.b2cs = b2csRows.map((r) => ({
            sply_ty: r.sply_ty, rt: r.rt, typ: 'OE', pos: r.pos, txval: r2(r.txval),
            ...(r.sply_ty === 'INTER' ? { iamt: r2(r.iamt) } : { camt: r2(r.camt), samt: r2(r.samt) }), csamt: 0,
        }));
    }
    if (cdnr.size) json.cdnr = [...cdnr.entries()].map(([ctin, nt]) => ({ ctin, nt }));
    if (cdnur.length) json.cdnur = cdnur;
    if (exp.size) json.exp = [...exp.entries()].map(([exp_typ, inv]) => ({ exp_typ, inv }));
    if (hsnB2B.size || hsnB2C.size) json.hsn = { hsn_b2b: hsnList(hsnB2B), hsn_b2c: hsnList(hsnB2C) };
    const issued = [docIssue('SALES', 1), docIssue('CREDIT_NOTE', 5)].filter(Boolean);
    if (issued.length) json.doc_issue = { doc_det: issued };

    const count = (k: string) => (Array.isArray(json[k]) ? (json[k] as any[]).reduce((s, x) => s + (x.inv?.length ?? x.nt?.length ?? 1), 0) : 0);
    return {
        json,
        summary: {
            period: { from, to, returnPeriod: returnPeriod(to) },
            counts: { b2b: count('b2b'), b2cl: count('b2cl'), b2cs: count('b2cs'), cdnr: count('cdnr'), cdnur: count('cdnur'), exp: count('exp') },
            documents: docs.length,
            warnings: [...new Set(warnings)],
        },
        // Lists for the on-screen tabs (kept for the existing page)
        b2b: docs.filter((d) => d.type === 'SALES' && d.party_gstin && !d.supply_type.startsWith('EXPORT')),
        b2cLarge: docs.filter((d) => d.type === 'SALES' && !d.party_gstin && !d.supply_type.startsWith('EXPORT') && isInter(d) && Number(d.grand_total) > B2CL_LIMIT),
        b2cSmall: docs.filter((d) => d.type === 'SALES' && !d.party_gstin && !d.supply_type.startsWith('EXPORT') && !(isInter(d) && Number(d.grand_total) > B2CL_LIMIT)),
        exports: docs.filter((d) => d.type === 'SALES' && d.supply_type.startsWith('EXPORT')),
        cdnr: docs.filter((d) => d.type !== 'SALES' && d.party_gstin),
        cdnur: docs.filter((d) => d.type !== 'SALES' && !d.party_gstin),
        hsn: { b2b: hsnList(hsnB2B), b2c: hsnList(hsnB2C) },
    };
};

/* ---------------- GSTR-3B ---------------- */

type TaxRow = { txval: number; iamt: number; camt: number; samt: number };
const zero = (): TaxRow => ({ txval: 0, iamt: 0, camt: 0, samt: 0 });
const out = (r: TaxRow) => ({ taxable_value: r2(r.txval), igst: r2(r.iamt), cgst: r2(r.camt), sgst: r2(r.samt) });

/**
 * GSTR-3B tables from the books (net of credit/debit notes):
 * 3.1(a) taxable outward, 3.1(b) zero-rated, 3.1(c) nil-rated/exempt, 3.1(d) inward under RCM,
 * 4(A)(3) ITC on RCM inward, 4(A)(5) all other ITC (net of debit notes / purchase returns).
 */
export const buildGstr3b = async (companyId: string, from: string, to: string) => {
    const sales = await loadDocs(companyId, from, to, ['SALES', 'CREDIT_NOTE']);
    const purchases = await loadDocs(companyId, from, to, ['PURCHASE', 'DEBIT_NOTE']);

    const t31a = zero();
    const t31b = zero();
    const t31c = zero();
    const t31d = zero();
    const itcRcm = zero();
    const itcOther = zero();

    const add = (row: TaxRow, it: DocRow['items'][number], sign: number, taxOnly = false) => {
        if (!taxOnly) row.txval += sign * toPaise(it.taxable_amount);
        row.iamt += sign * toPaise(it.igst_amount);
        row.camt += sign * toPaise(it.cgst_amount);
        row.samt += sign * toPaise(it.sgst_amount);
    };

    for (const d of sales) {
        const sign = d.type === 'CREDIT_NOTE' ? -1 : 1;
        for (const it of d.items) {
            if (d.supply_type !== 'NORMAL' && d.supply_type !== 'DEEMED_EXPORT') add(t31b, it, sign);
            else if (Number(it.tax_rate) === 0) add(t31c, it, sign);
            else add(t31a, it, sign);
        }
    }
    for (const d of purchases) {
        // Debit notes (purchase returns) reverse the ITC taken on the original bill
        const sign = d.type === 'DEBIT_NOTE' ? -1 : 1;
        for (const it of d.items) {
            if (sign < 0) {
                add(itcOther, it, -1);
            } else if (d.reverse_charge) {
                add(t31d, it, 1);
                add(itcRcm, it, 1);
            } else {
                add(itcOther, it, 1);
            }
        }
    }

    const liability = { iamt: t31a.iamt + t31b.iamt + t31d.iamt, camt: t31a.camt + t31d.camt, samt: t31a.samt + t31d.samt };
    const itc = { iamt: itcRcm.iamt + itcOther.iamt, camt: itcRcm.camt + itcOther.camt, samt: itcRcm.samt + itcOther.samt };
    // RCM tax must be paid in cash even though its ITC is available
    const cashMin = { iamt: t31d.iamt, camt: t31d.camt, samt: t31d.samt };

    const outward = { txval: t31a.txval + t31b.txval + t31c.txval, iamt: t31a.iamt + t31b.iamt, camt: t31a.camt, samt: t31a.samt };
    const allItc = { txval: 0, iamt: itc.iamt, camt: itc.camt, samt: itc.samt };
    return {
        period: { from, to, returnPeriod: returnPeriod(to) },
        tables: {
            '3.1(a)': out(t31a),
            '3.1(b)': out(t31b),
            '3.1(c)': out(t31c),
            '3.1(d)': out(t31d),
            '4(A)(3)': out(itcRcm),
            '4(A)(5)': out(itcOther),
        },
        liability: { igst: r2(liability.iamt), cgst: r2(liability.camt), sgst: r2(liability.samt) },
        itc: { igst: r2(itc.iamt), cgst: r2(itc.camt), sgst: r2(itc.samt) },
        rcm_cash: { igst: r2(cashMin.iamt), cgst: r2(cashMin.camt), sgst: r2(cashMin.samt) },
        // Simple netting (before cross-utilisation rules of section 49): tax payable minus ITC, not below zero
        net_payable: {
            igst: r2(Math.max(liability.iamt - itc.iamt, 0)),
            cgst: r2(Math.max(liability.camt - itc.camt, 0)),
            sgst: r2(Math.max(liability.samt - itc.samt, 0)),
        },
        // Fields used by the existing page
        outward_supplies: { ...out(outward) },
        eligible_itc: { ...out(allItc) },
    };
};

/* ---------------- TDS register ---------------- */

export const tdsRegister = async (companyId: string, from: string, to: string) => {
    const rows = (
        await query(
            `SELECT i.id, i.invoice_number, i.date, i.tds_section, i.tds_rate, i.tds_amount, i.subtotal,
                    l.name AS party_name, COALESCE(l.pan, substring(l.gstin from 3 for 10)) AS party_pan
             FROM invoices i JOIN ledgers l ON l.id = i.party_ledger_id
             WHERE i.company_id = $1 AND i.tds_amount > 0 AND i.date BETWEEN $2 AND $3 AND COALESCE(i.status, '') <> 'CANCELLED'
             ORDER BY i.tds_section, i.date`,
            [companyId, from, to]
        )
    ).rows.map((r) => ({ ...r, tds_rate: Number(r.tds_rate), tds_amount: Number(r.tds_amount), subtotal: Number(r.subtotal) }));
    const bySection = new Map<string, { section: string; base: number; tds: number; count: number }>();
    for (const r of rows) {
        const s = bySection.get(r.tds_section) ?? { section: r.tds_section, base: 0, tds: 0, count: 0 };
        s.base += toPaise(r.subtotal);
        s.tds += toPaise(r.tds_amount);
        s.count++;
        bySection.set(r.tds_section, s);
    }
    return {
        period: { from, to },
        entries: rows,
        sections: [...bySection.values()].map((s) => ({ ...s, base: r2(s.base), tds: r2(s.tds) })),
        missingPan: rows.filter((r) => !r.party_pan).map((r) => r.party_name),
        total: r2(rows.reduce((s, r) => s + toPaise(r.tds_amount), 0)),
    };
};
