import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { fromPaise, toPaise } from '../utils/money';

/** A supplier document as reported in GSTR-2B, normalised. Amounts in rupees. */
export interface TwoBDoc {
    kind: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
    ctin: string;
    supplier: string;
    number: string;
    date: string; // YYYY-MM-DD
    value: number;
    taxable: number;
    igst: number;
    cgst: number;
    sgst: number;
    itcAvailable: boolean;
    reverseCharge: boolean;
}

const isoFromDmy = (d: string) => {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(d || '').trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : String(d || '').slice(0, 10);
};

const sumItems = (items: any[] = []) => {
    const t = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    for (const it of items) {
        const d = it.itm_det ?? it; // older formats nest values in itm_det
        t.taxable += toPaise(d.txval ?? 0);
        t.igst += toPaise(d.igst ?? d.iamt ?? 0);
        t.cgst += toPaise(d.cgst ?? d.camt ?? 0);
        t.sgst += toPaise(d.sgst ?? d.samt ?? 0);
    }
    return { taxable: fromPaise(t.taxable), igst: fromPaise(t.igst), cgst: fromPaise(t.cgst), sgst: fromPaise(t.sgst) };
};

/**
 * Parses a GSTR-2B JSON downloaded from the GST portal (B2B invoices and
 * credit/debit notes). Accepts both the API layout ({data:{docdata}}) and the
 * offline-tool layout (docdata at the root).
 */
export const parseGstr2b = (raw: unknown): { period: string | null; gstin: string | null; documents: TwoBDoc[] } => {
    let root: any = raw;
    if (typeof raw === 'string') {
        try {
            root = JSON.parse(raw);
        } catch {
            throw new AppError('The file is not valid JSON. Download GSTR-2B as JSON from the GST portal.', 400);
        }
    }
    const data = root?.data ?? root;
    const docdata = data?.docdata ?? data;
    if (!docdata || (!docdata.b2b && !docdata.cdnr && !docdata.b2ba)) {
        throw new AppError('This does not look like a GSTR-2B file (no B2B section found)', 400);
    }

    const documents: TwoBDoc[] = [];
    for (const sup of docdata.b2b ?? []) {
        for (const inv of sup.inv ?? []) {
            documents.push({
                kind: 'INVOICE',
                ctin: String(sup.ctin || '').toUpperCase(),
                supplier: sup.trdnm || sup.ctin,
                number: String(inv.inum),
                date: isoFromDmy(inv.dt ?? inv.idt),
                value: Number(inv.val || 0),
                ...sumItems(inv.items ?? inv.itms),
                itcAvailable: (inv.itcavl ?? 'Y') !== 'N',
                reverseCharge: (inv.rev ?? inv.rchrg ?? 'N') === 'Y',
            });
        }
    }
    for (const sup of docdata.cdnr ?? []) {
        for (const nt of sup.nt ?? []) {
            documents.push({
                kind: (nt.typ ?? nt.ntty) === 'D' ? 'DEBIT_NOTE' : 'CREDIT_NOTE',
                ctin: String(sup.ctin || '').toUpperCase(),
                supplier: sup.trdnm || sup.ctin,
                number: String(nt.ntnum ?? nt.nt_num),
                date: isoFromDmy(nt.dt ?? nt.nt_dt),
                value: Number(nt.val || 0),
                ...sumItems(nt.items ?? nt.itms),
                itcAvailable: (nt.itcavl ?? 'Y') !== 'N',
                reverseCharge: (nt.rev ?? 'N') === 'Y',
            });
        }
    }
    return { period: data.rtnprd ?? root.rtnprd ?? null, gstin: data.gstin ?? root.gstin ?? null, documents };
};

export const saveGstr2b = async (companyId: string, raw: unknown, fileName: string | null, userId: string, periodOverride?: string) => {
    const company = (await query('SELECT gstin FROM companies WHERE id = $1', [companyId])).rows[0];
    const parsed = parseGstr2b(raw);
    if (parsed.gstin && company?.gstin && parsed.gstin.toUpperCase() !== company.gstin.toUpperCase()) {
        throw new AppError(`This GSTR-2B is for ${parsed.gstin}, but this company's GSTIN is ${company.gstin}`, 400);
    }
    const period = periodOverride || parsed.period;
    if (!period || !/^\d{6}$/.test(period)) throw new AppError('Return period (MMYYYY) is missing; choose the month', 400);
    await query(
        `INSERT INTO gstr2b_imports (company_id, return_period, file_name, documents, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, return_period) DO UPDATE SET file_name = EXCLUDED.file_name,
             documents = EXCLUDED.documents, uploaded_by = EXCLUDED.uploaded_by, created_at = NOW()`,
        [companyId, period, fileName, JSON.stringify(parsed.documents), userId]
    );
    return { period, documents: parsed.documents.length };
};

/** Supplier invoice numbers are typed differently everywhere: compare A-Z0-9 only, no leading zeros. */
export const normaliseDocNo = (n: string) =>
    String(n || '')
        .toUpperCase()
        .replace(/(^|[^0-9])0+(?=\d)/g, '$1') // drop leading zeros of every number group: SS-0077 -> SS-77
        .replace(/[^A-Z0-9]/g, '');

const TOLERANCE = 100; // ₹1.00 in paise

export const reconcileGstr2b = async (companyId: string, period: string) => {
    const imp = (await query('SELECT * FROM gstr2b_imports WHERE company_id = $1 AND return_period = $2', [companyId, period])).rows[0];
    if (!imp) throw new AppError('Upload the GSTR-2B for this month first', 404);
    const docs: TwoBDoc[] = imp.documents;

    const month = `${period.slice(2)}-${period.slice(0, 2)}`; // YYYY-MM
    const monthStart = `${month}-01`;
    const monthEnd = new Date(Date.UTC(+period.slice(2), +period.slice(0, 2), 0)).toISOString().slice(0, 10);

    // Bills from the last 12 months can appear in this 2B (suppliers file late)
    const books = (
        await query(
            `SELECT i.id, i.invoice_number, i.date, i.grand_total, i.reverse_charge, l.gstin, l.name AS party_name,
                    COALESCE(SUM(ii.taxable_amount), 0) AS taxable, COALESCE(SUM(ii.igst_amount), 0) AS igst,
                    COALESCE(SUM(ii.cgst_amount), 0) AS cgst, COALESCE(SUM(ii.sgst_amount), 0) AS sgst
             FROM invoices i JOIN ledgers l ON l.id = i.party_ledger_id
             LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
             WHERE i.company_id = $1 AND i.type = 'PURCHASE' AND NOT i.is_opening AND COALESCE(i.status, '') <> 'CANCELLED' AND l.gstin IS NOT NULL AND l.gstin <> ''
               AND i.date BETWEEN ($2::date - interval '12 months') AND $3::date
             GROUP BY i.id, l.gstin, l.name`,
            [companyId, monthStart, monthEnd]
        )
    ).rows;

    const key = (gstin: string, no: string) => `${gstin.toUpperCase()}|${normaliseDocNo(no)}`;
    const bookMap = new Map(books.map((b) => [key(b.gstin, b.invoice_number), b]));
    const used = new Set<string>();

    const matched: any[] = [];
    const mismatched: any[] = [];
    const missingInBooks: any[] = [];
    for (const d of docs.filter((x) => x.kind === 'INVOICE')) {
        const b = bookMap.get(key(d.ctin, d.number));
        if (!b) {
            missingInBooks.push(d);
            continue;
        }
        used.add(b.id);
        const diff = {
            taxable: fromPaise(toPaise(d.taxable) - toPaise(b.taxable)),
            igst: fromPaise(toPaise(d.igst) - toPaise(b.igst)),
            cgst: fromPaise(toPaise(d.cgst) - toPaise(b.cgst)),
            sgst: fromPaise(toPaise(d.sgst) - toPaise(b.sgst)),
        };
        const ok = Object.values(diff).every((v) => Math.abs(toPaise(v)) <= TOLERANCE);
        const row = {
            portal: d,
            books: { id: b.id, number: b.invoice_number, date: b.date, taxable: Number(b.taxable), igst: Number(b.igst), cgst: Number(b.cgst), sgst: Number(b.sgst) },
            diff,
            dateDiffers: d.date !== b.date,
        };
        (ok ? matched : mismatched).push(row);
    }
    // Bills dated in this month that the supplier has not reported (ITC at risk)
    const missingIn2b = books
        .filter((b) => !used.has(b.id) && b.date >= monthStart && b.date <= monthEnd)
        .map((b) => ({ id: b.id, number: b.invoice_number, date: b.date, gstin: b.gstin, supplier: b.party_name, taxable: Number(b.taxable), igst: Number(b.igst), cgst: Number(b.cgst), sgst: Number(b.sgst) }));

    const tax = (xs: { igst: number; cgst: number; sgst: number }[]) => fromPaise(xs.reduce((s, x) => s + toPaise(x.igst) + toPaise(x.cgst) + toPaise(x.sgst), 0));
    return {
        period,
        uploadedAt: imp.created_at,
        fileName: imp.file_name,
        summary: {
            portalInvoices: docs.filter((x) => x.kind === 'INVOICE').length,
            matched: matched.length,
            mismatched: mismatched.length,
            missingInBooks: missingInBooks.length,
            missingIn2b: missingIn2b.length,
            itcAsPer2b: tax(docs.filter((x) => x.kind === 'INVOICE' && x.itcAvailable)),
            itcMatched: tax(matched.map((m) => m.portal)),
            itcAtRisk: tax(missingIn2b),
        },
        matched,
        mismatched,
        missingInBooks,
        missingIn2b,
        notes: docs.filter((x) => x.kind !== 'INVOICE'),
    };
};

/** Uploaded GSTR-2B files, latest period first. */
export const listGstr2bImports = async (companyId: string) =>
    (
        await query(
            `SELECT return_period, file_name, jsonb_array_length(documents) AS documents, created_at
             FROM gstr2b_imports WHERE company_id = $1 ORDER BY substring(return_period from 3) DESC, substring(return_period from 1 for 2) DESC`,
            [companyId]
        )
    ).rows;
