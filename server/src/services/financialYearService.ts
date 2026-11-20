/** Financial year administration (listing, creating, activating, closing). */
import { query, withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';

export const listFinancialYears = async (companyId: string) =>
    (await query('SELECT * FROM financial_years WHERE company_id = $1 ORDER BY start_date DESC', [companyId])).rows;

export const getActiveFinancialYear = async (companyId: string) => {
    const r = await query('SELECT * FROM financial_years WHERE company_id = $1 AND is_active = true LIMIT 1', [companyId]);
    if (!r.rows.length) throw new AppError('No active financial year found', 404);
    return r.rows[0];
};

export const createFinancialYear = async (companyId: string, input: { name: string; startDate: string; endDate: string }) => {
    if (input.endDate <= input.startDate) throw new AppError('End date must be after start date', 400);
    const overlap = await query(
        'SELECT name FROM financial_years WHERE company_id = $1 AND start_date <= $3 AND end_date >= $2',
        [companyId, input.startDate, input.endDate]
    );
    if (overlap.rows.length) throw new AppError(`Dates overlap with financial year ${overlap.rows[0].name}`, 400);
    return (
        await query(
            `INSERT INTO financial_years (company_id, name, start_date, end_date, is_active, is_closed)
             VALUES ($1, $2, $3, $4, false, false) RETURNING *`,
            [companyId, input.name, input.startDate, input.endDate]
        )
    ).rows[0];
};

export const activateFinancialYear = (companyId: string, id: string) =>
    withTransaction(async (db) => {
        const year = await db.query('SELECT * FROM financial_years WHERE id = $1 AND company_id = $2', [id, companyId]);
        if (!year.rows.length) throw new AppError('Financial year not found', 404);
        if (year.rows[0].is_closed) throw new AppError('Cannot activate a closed financial year', 400);
        await db.query('UPDATE financial_years SET is_active = false WHERE company_id = $1', [companyId]);
        return (await db.query('UPDATE financial_years SET is_active = true WHERE id = $1 RETURNING *', [id])).rows[0];
    });

/** Closing a year locks it: no vouchers/invoices can be created, edited or deleted in it. */
export const closeFinancialYear = async (companyId: string, id: string) => {
    const r = await query(
        'UPDATE financial_years SET is_closed = true, is_active = false WHERE id = $1 AND company_id = $2 AND NOT is_closed RETURNING *',
        [id, companyId]
    );
    if (!r.rows.length) throw new AppError('Financial year not found or already closed', 400);
    return r.rows[0];
};

export const reopenFinancialYear = async (companyId: string, id: string) => {
    const r = await query('UPDATE financial_years SET is_closed = false WHERE id = $1 AND company_id = $2 RETURNING *', [id, companyId]);
    if (!r.rows.length) throw new AppError('Financial year not found', 404);
    return r.rows[0];
};

export const deleteFinancialYear = async (companyId: string, id: string) => {
    const year = await query('SELECT * FROM financial_years WHERE id = $1 AND company_id = $2', [id, companyId]);
    if (!year.rows.length) throw new AppError('Financial year not found', 404);
    const y = year.rows[0];
    const used = await query('SELECT COUNT(*)::int AS n FROM vouchers WHERE company_id = $1 AND date BETWEEN $2 AND $3', [
        y.company_id, y.start_date, y.end_date,
    ]);
    if (used.rows[0].n > 0) throw new AppError('Cannot delete a financial year that has vouchers', 400);
    await query('DELETE FROM financial_years WHERE id = $1', [id]);
};
