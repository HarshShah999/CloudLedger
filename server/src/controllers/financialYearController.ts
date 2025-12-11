import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

// Get all financial years for a company
export const getFinancialYears = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId } = req.query;

    if (!companyId) {
        return next(new AppError('Company ID is required', 400));
    }

    try {
        const result = await query(
            'SELECT * FROM financial_years WHERE company_id = $1 ORDER BY start_date DESC',
            [companyId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                financialYears: result.rows,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Get active financial year for a company
export const getActiveFinancialYear = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId } = req.query;

    if (!companyId) {
        return next(new AppError('Company ID is required', 400));
    }

    try {
        const result = await query(
            'SELECT * FROM financial_years WHERE company_id = $1 AND is_active = true LIMIT 1',
            [companyId]
        );

        if (result.rows.length === 0) {
            return next(new AppError('No active financial year found', 404));
        }

        res.status(200).json({
            status: 'success',
            data: {
                financialYear: result.rows[0],
            },
        });
    } catch (error) {
        next(error);
    }
};

// Create new financial year
export const createFinancialYear = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, name, startDate, endDate } = req.body;

    try {
        // Check for overlapping financial years
        const overlap = await query(
            `SELECT * FROM financial_years 
             WHERE company_id = $1 
             AND ((start_date <= $2 AND end_date >= $2) 
                  OR (start_date <= $3 AND end_date >= $3)
                  OR (start_date >= $2 AND end_date <= $3))`,
            [companyId, startDate, endDate]
        );

        if (overlap.rows.length > 0) {
            return next(new AppError('Financial year dates overlap with existing year', 400));
        }

        const result = await query(
            'INSERT INTO financial_years (company_id, name, start_date, end_date, is_active, is_closed) VALUES ($1, $2, $3, $4, false, false) RETURNING *',
            [companyId, name, startDate, endDate]
        );

        res.status(201).json({
            status: 'success',
            data: {
                financialYear: result.rows[0],
            },
        });
    } catch (error) {
        next(error);
    }
};

// Activate financial year (deactivate others)
export const activateFinancialYear = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { companyId } = req.body;

    try {
        // Check if year is closed
        const yearCheck = await query('SELECT * FROM financial_years WHERE id = $1', [id]);
        if (yearCheck.rows.length === 0) {
            return next(new AppError('Financial year not found', 404));
        }
        if (yearCheck.rows[0].is_closed) {
            return next(new AppError('Cannot activate a closed financial year', 400));
        }

        // Deactivate all other years for this company
        await query(
            'UPDATE financial_years SET is_active = false WHERE company_id = $1',
            [companyId]
        );

        // Activate this year
        const result = await query(
            'UPDATE financial_years SET is_active = true WHERE id = $1 RETURNING *',
            [id]
        );

        res.status(200).json({
            status: 'success',
            data: {
                financialYear: result.rows[0],
            },
        });
    } catch (error) {
        next(error);
    }
};

// Close financial year (lock period)
export const closeFinancialYear = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        // Check if year exists and is not already closed
        const yearCheck = await query('SELECT * FROM financial_years WHERE id = $1', [id]);
        if (yearCheck.rows.length === 0) {
            return next(new AppError('Financial year not found', 404));
        }
        if (yearCheck.rows[0].is_closed) {
            return next(new AppError('Financial year is already closed', 400));
        }

        // Close the year
        const result = await query(
            'UPDATE financial_years SET is_closed = true, is_active = false WHERE id = $1 RETURNING *',
            [id]
        );

        res.status(200).json({
            status: 'success',
            message: 'Financial year closed successfully',
            data: {
                financialYear: result.rows[0],
            },
        });
    } catch (error) {
        next(error);
    }
};

// Reopen financial year
export const reopenFinancialYear = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        const result = await query(
            'UPDATE financial_years SET is_closed = false WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return next(new AppError('Financial year not found', 404));
        }

        res.status(200).json({
            status: 'success',
            message: 'Financial year reopened successfully',
            data: {
                financialYear: result.rows[0],
            },
        });
    } catch (error) {
        next(error);
    }
};

// Delete financial year
export const deleteFinancialYear = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        // Check if there are any vouchers in this period
        const yearCheck = await query('SELECT * FROM financial_years WHERE id = $1', [id]);
        if (yearCheck.rows.length === 0) {
            return next(new AppError('Financial year not found', 404));
        }

        const year = yearCheck.rows[0];
        const voucherCheck = await query(
            'SELECT COUNT(*) FROM vouchers WHERE company_id = $1 AND date >= $2 AND date <= $3',
            [year.company_id, year.start_date, year.end_date]
        );

        if (parseInt(voucherCheck.rows[0].count) > 0) {
            return next(new AppError('Cannot delete financial year with existing vouchers', 400));
        }

        await query('DELETE FROM financial_years WHERE id = $1', [id]);

        res.status(204).json({
            status: 'success',
            data: null,
        });
    } catch (error) {
        next(error);
    }
};

// Check if date is in locked period
export const checkPeriodLocked = async (companyId: string, date: string): Promise<boolean> => {
    const result = await query(
        'SELECT is_active FROM financial_years WHERE company_id = $1 AND $2 >= start_date AND $2 <= end_date',
        [companyId, date]
    );

    if (result.rows.length > 0 && result.rows[0].is_closed) {
        return true;
    }
    return false;
};
