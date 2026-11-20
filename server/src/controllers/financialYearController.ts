import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { isPeriodLocked } from '../services/financialYear';

export const getFinancialYears = async (req: Request, res: Response) => {
    const result = await query('SELECT * FROM financial_years WHERE company_id = $1 ORDER BY start_date DESC', [
        req.company!.id,
    ]);
    res.status(200).json({ status: 'success', data: { financialYears: result.rows } });
};

export const getActiveFinancialYear = async (req: Request, res: Response) => {
    const result = await query('SELECT * FROM financial_years WHERE company_id = $1 AND is_active = true LIMIT 1', [
        req.company!.id,
    ]);
    if (!result.rows.length) throw new AppError('No active financial year found', 404);
    res.status(200).json({ status: 'success', data: { financialYear: result.rows[0] } });
};

export const createFinancialYear = async (req: Request, res: Response) => {
    const { name, startDate, endDate } = req.body;
    const companyId = req.company!.id;
    if (endDate <= startDate) throw new AppError('End date must be after start date', 400);

    const overlap = await query(
        'SELECT name FROM financial_years WHERE company_id = $1 AND start_date <= $3 AND end_date >= $2',
        [companyId, startDate, endDate]
    );
    if (overlap.rows.length) throw new AppError(`Dates overlap with financial year ${overlap.rows[0].name}`, 400);

    const result = await query(
        `INSERT INTO financial_years (company_id, name, start_date, end_date, is_active, is_closed)
         VALUES ($1, $2, $3, $4, false, false) RETURNING *`,
        [companyId, name, startDate, endDate]
    );
    res.status(201).json({ status: 'success', data: { financialYear: result.rows[0] } });
};

export const activateFinancialYear = async (req: Request, res: Response) => {
    const companyId = req.company!.id;
    const fy = await withTransaction(async (db) => {
        const year = await db.query('SELECT * FROM financial_years WHERE id = $1 AND company_id = $2', [req.params.id, companyId]);
        if (!year.rows.length) throw new AppError('Financial year not found', 404);
        if (year.rows[0].is_closed) throw new AppError('Cannot activate a closed financial year', 400);
        await db.query('UPDATE financial_years SET is_active = false WHERE company_id = $1', [companyId]);
        return (await db.query('UPDATE financial_years SET is_active = true WHERE id = $1 RETURNING *', [req.params.id])).rows[0];
    });
    res.status(200).json({ status: 'success', data: { financialYear: fy } });
};

/** Closing a year locks it: no vouchers/invoices can be created, edited or deleted in it. */
export const closeFinancialYear = async (req: Request, res: Response) => {
    const result = await query(
        'UPDATE financial_years SET is_closed = true, is_active = false WHERE id = $1 AND company_id = $2 AND NOT is_closed RETURNING *',
        [req.params.id, req.company!.id]
    );
    if (!result.rows.length) throw new AppError('Financial year not found or already closed', 400);
    res.status(200).json({ status: 'success', message: 'Financial year closed', data: { financialYear: result.rows[0] } });
};

export const reopenFinancialYear = async (req: Request, res: Response) => {
    const result = await query('UPDATE financial_years SET is_closed = false WHERE id = $1 AND company_id = $2 RETURNING *', [
        req.params.id,
        req.company!.id,
    ]);
    if (!result.rows.length) throw new AppError('Financial year not found', 404);
    res.status(200).json({ status: 'success', message: 'Financial year reopened', data: { financialYear: result.rows[0] } });
};

export const deleteFinancialYear = async (req: Request, res: Response) => {
    const year = await query('SELECT * FROM financial_years WHERE id = $1 AND company_id = $2', [req.params.id, req.company!.id]);
    if (!year.rows.length) throw new AppError('Financial year not found', 404);
    const y = year.rows[0];
    const used = await query('SELECT COUNT(*)::int AS n FROM vouchers WHERE company_id = $1 AND date BETWEEN $2 AND $3', [
        y.company_id,
        y.start_date,
        y.end_date,
    ]);
    if (used.rows[0].n > 0) throw new AppError('Cannot delete a financial year that has vouchers', 400);
    await query('DELETE FROM financial_years WHERE id = $1', [req.params.id]);
    res.status(204).send();
};

/** @deprecated use services/financialYear.isPeriodLocked */
export const checkPeriodLocked = (companyId: string, date: string) => isPeriodLocked({ query }, companyId, date);
