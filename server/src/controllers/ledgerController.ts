import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

// --- Groups ---

export const getGroups = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId } = req.query;

    if (!companyId) {
        return next(new AppError('Company ID is required', 400));
    }

    try {
        const result = await query(
            'SELECT * FROM ledger_groups WHERE company_id = $1 ORDER BY name',
            [companyId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                groups: result.rows,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const createGroup = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, name, parentId, type } = req.body;

    try {
        const result = await query(
            'INSERT INTO ledger_groups (company_id, name, parent_id, type) VALUES ($1, $2, $3, $4) RETURNING *',
            [companyId, name, parentId, type]
        );

        res.status(201).json({
            status: 'success',
            data: {
                group: result.rows[0],
            },
        });
    } catch (error) {
        next(error);
    }
};

// --- Ledgers ---

export const getLedgers = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId } = req.query;

    if (!companyId) {
        return next(new AppError('Company ID is required', 400));
    }

    try {
        const result = await query(
            `SELECT l.*, lg.name as group_name 
       FROM ledgers l 
       LEFT JOIN ledger_groups lg ON l.group_id = lg.id 
       WHERE l.company_id = $1 
       ORDER BY l.name`,
            [companyId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                ledgers: result.rows,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const createLedger = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, groupId, name, openingBalance, openingBalanceType } = req.body;

    try {
        const result = await query(
            'INSERT INTO ledgers (company_id, group_id, name, opening_balance, opening_balance_type, current_balance) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [companyId, groupId, name, openingBalance || 0, openingBalanceType || 'Dr', openingBalance || 0] // Initial current balance = opening balance (simplified)
        );

        res.status(201).json({
            status: 'success',
            data: {
                ledger: result.rows[0],
            },
        });
    } catch (error) {
        next(error);
    }
};

export const updateLedger = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { name, groupId, openingBalance, openingBalanceType } = req.body;

    try {
        const result = await query(
            'UPDATE ledgers SET name = $1, group_id = $2, opening_balance = $3, opening_balance_type = $4 WHERE id = $5 RETURNING *',
            [name, groupId, openingBalance, openingBalanceType, id]
        );

        if (result.rows.length === 0) {
            return next(new AppError('Ledger not found', 404));
        }

        res.status(200).json({
            status: 'success',
            data: {
                ledger: result.rows[0],
            },
        });
    } catch (error) {
        next(error);
    }
};

export const deleteLedger = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        // Check if used in vouchers
        const check = await query('SELECT * FROM voucher_entries WHERE ledger_id = $1', [id]);
        if (check.rows.length > 0) {
            return next(new AppError('Cannot delete ledger with existing transactions', 400));
        }

        const result = await query('DELETE FROM ledgers WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return next(new AppError('Ledger not found', 404));
        }

        res.status(204).json({
            status: 'success',
            data: null,
        });
    } catch (error) {
        next(error);
    }
};
