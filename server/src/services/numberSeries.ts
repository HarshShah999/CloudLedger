import { Queryable } from '../config/db';
import { FinancialYearRow } from './financialYear';

/** Default prefixes per document type. */
export const DEFAULT_PREFIX: Record<string, string> = {
    SALES: 'INV',
    PURCHASE: 'PUR',
    CREDIT_NOTE: 'CN',
    DEBIT_NOTE: 'DN',
    RECEIPT: 'RCT',
    PAYMENT: 'PMT',
    JOURNAL: 'JV',
    CONTRA: 'CTR',
};

/** Maps a voucher type name to its document type key. */
export const docTypeForVoucherType = (name: string): string =>
    name.trim().toUpperCase().replace(/\s+/g, '_');

const fyShort = (fy: FinancialYearRow) => {
    const start = Number(fy.start_date.slice(0, 4));
    const end = Number(fy.end_date.slice(0, 4));
    return `${String(start % 100).padStart(2, '0')}-${String(end % 100).padStart(2, '0')}`;
};

/** e.g. INV/25-26/0001 — at most 16 characters as required for GST invoices. */
const format = (prefix: string, fy: FinancialYearRow, n: number, padding: number) => {
    const p = prefix ? `${prefix}/` : '';
    return `${p}${fyShort(fy)}/${String(n).padStart(padding, '0')}`;
};

const DOC_TABLES: Record<string, { sql: string }> = {
    invoice: {
        sql: `SELECT 1 FROM invoices WHERE company_id = $1 AND type = $2 AND financial_year_id = $3 AND lower(invoice_number) = lower($4)`,
    },
    voucher: {
        sql: `SELECT 1 FROM vouchers v JOIN voucher_types vt ON vt.id = v.voucher_type_id
              WHERE v.company_id = $1 AND upper(replace(vt.name, ' ', '_')) = $2 AND v.financial_year_id = $3
              AND lower(v.voucher_number) = lower($4)`,
    },
};

const kindFor = (docType: string) =>
    ['SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(docType) ? 'invoice' : 'voucher';

const getSeries = async (db: Queryable, companyId: string, docType: string, fy: FinancialYearRow, lock: boolean) => {
    await db.query(
        `INSERT INTO number_series (company_id, doc_type, financial_year_id, prefix)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [companyId, docType, fy.id, DEFAULT_PREFIX[docType] ?? docType.slice(0, 3)]
    );
    const r = await db.query(
        `SELECT * FROM number_series WHERE company_id = $1 AND doc_type = $2 AND financial_year_id = $3 ${lock ? 'FOR UPDATE' : ''}`,
        [companyId, docType, fy.id]
    );
    return r.rows[0];
};

/** Returns the next free number without consuming it (for pre-filling forms). */
export const peekNextNumber = async (
    db: Queryable,
    companyId: string,
    docType: string,
    fy: FinancialYearRow
): Promise<string> => {
    const series = await getSeries(db, companyId, docType, fy, false);
    const check = DOC_TABLES[kindFor(docType)].sql;
    let n = series.next_number;
    for (let i = 0; i < 10000; i++, n++) {
        const candidate = format(series.prefix, fy, n, series.padding);
        if (!(await db.query(check, [companyId, docType, fy.id, candidate])).rows.length) return candidate;
    }
    throw new Error('Could not find a free document number');
};

/**
 * Reserves a document number inside the current transaction.
 * - If `requested` is empty, issues the next free number from the series.
 * - If `requested` is given and equals the series' next number, the series advances.
 * Returns the number to use; uniqueness is checked by the caller/DB index.
 */
export const reserveNumber = async (
    db: Queryable,
    companyId: string,
    docType: string,
    fy: FinancialYearRow,
    requested?: string | null
): Promise<string> => {
    const series = await getSeries(db, companyId, docType, fy, true);
    const check = DOC_TABLES[kindFor(docType)].sql;
    const wanted = requested?.trim();

    let n = series.next_number;
    let candidate = format(series.prefix, fy, n, series.padding);
    while ((await db.query(check, [companyId, docType, fy.id, candidate])).rows.length) {
        n++;
        candidate = format(series.prefix, fy, n, series.padding);
    }

    if (!wanted || wanted.toLowerCase() === candidate.toLowerCase()) {
        await db.query('UPDATE number_series SET next_number = $1 WHERE id = $2', [n + 1, series.id]);
        return candidate;
    }
    return wanted;
};
