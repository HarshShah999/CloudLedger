import { Queryable } from '../config/db';
import { AppError } from '../middleware/errorHandler';

/** Indian financial year (1 April – 31 March) containing `date` (YYYY-MM-DD). */
export const indianFinancialYear = (date: string) => {
    const [y, m] = date.split('-').map(Number);
    const startYear = m >= 4 ? y : y - 1;
    return {
        name: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
        startDate: `${startYear}-04-01`,
        endDate: `${startYear + 1}-03-31`,
    };
};

export const toDateString = (d: string | Date): string => {
    if (typeof d === 'string') return d.slice(0, 10);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
};

export interface FinancialYearRow {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    is_active: boolean;
    is_closed: boolean;
}

/**
 * Returns the financial year a transaction dated `date` belongs to.
 * - Throws if that year is closed (period lock).
 * - If no year covers the date, creates the Indian FY for it (unless it would
 *   overlap a custom year, in which case the user must create one).
 */
export const resolveFinancialYear = async (
    db: Queryable,
    companyId: string,
    rawDate: string | Date,
    { autoCreate = true } = {}
): Promise<FinancialYearRow> => {
    const date = toDateString(rawDate);
    const found = await db.query(
        `SELECT * FROM financial_years WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date
         ORDER BY start_date DESC LIMIT 1`,
        [companyId, date]
    );
    let fy: FinancialYearRow | undefined = found.rows[0];

    if (!fy) {
        if (!autoCreate) throw new AppError(`No financial year covers ${date}`, 400);
        const ind = indianFinancialYear(date);
        const overlap = await db.query(
            `SELECT 1 FROM financial_years WHERE company_id = $1 AND start_date <= $3 AND end_date >= $2`,
            [companyId, ind.startDate, ind.endDate]
        );
        if (overlap.rows.length) {
            throw new AppError(`No financial year covers ${date}. Create one under Financial Years.`, 400);
        }
        const hasActive = await db.query('SELECT 1 FROM financial_years WHERE company_id = $1 AND is_active', [companyId]);
        fy = (
            await db.query(
                `INSERT INTO financial_years (company_id, name, start_date, end_date, is_active, is_closed)
                 VALUES ($1, $2, $3, $4, $5, false) RETURNING *`,
                [companyId, ind.name, ind.startDate, ind.endDate, hasActive.rows.length === 0]
            )
        ).rows[0];
    }

    if (fy!.is_closed) {
        throw new AppError(`Financial year ${fy!.name} is closed. Reopen it to post or change entries dated ${date}.`, 400);
    }
    return fy!;
};

/** True if `date` falls in a closed financial year. */
export const isPeriodLocked = async (db: Queryable, companyId: string, date: string | Date): Promise<boolean> => {
    const r = await db.query(
        `SELECT 1 FROM financial_years WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date AND is_closed`,
        [companyId, toDateString(date)]
    );
    return r.rows.length > 0;
};
