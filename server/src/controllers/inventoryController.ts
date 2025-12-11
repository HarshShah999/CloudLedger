import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

// --- Units Controller ---

export const createUnit = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, name, symbol } = req.body;

    try {
        const result = await query(
            'INSERT INTO units (company_id, name, symbol) VALUES ($1, $2, $3) RETURNING *',
            [companyId, name, symbol]
        );
        res.status(201).json({ status: 'success', data: { unit: result.rows[0] } });
    } catch (error: any) {
        if (error.code === '23505') {
            return next(new AppError('Unit with this name already exists', 400));
        }
        next(error);
    }
};

export const getUnits = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId } = req.query;

    try {
        const result = await query(
            'SELECT * FROM units WHERE company_id = $1 ORDER BY name',
            [companyId]
        );
        res.status(200).json({ status: 'success', data: { units: result.rows } });
    } catch (error) {
        next(error);
    }
};

export const deleteUnit = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        await query('DELETE FROM units WHERE id = $1', [id]);
        res.status(204).json({ status: 'success', data: null });
    } catch (error) {
        next(error);
    }
};

// --- Items Controller ---

export const createItem = async (req: Request, res: Response, next: NextFunction) => {
    const {
        companyId, name, hsnCode, unitId,
        taxRate, salesRate, purchaseRate,
        openingQuantity
    } = req.body;

    try {
        const result = await query(
            `INSERT INTO items (
                company_id, name, hsn_code, unit_id, 
                tax_rate, sales_rate, purchase_rate, 
                opening_quantity, current_quantity
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`,
            [companyId, name, hsnCode, unitId, taxRate, salesRate, purchaseRate, openingQuantity || 0]
        );
        res.status(201).json({ status: 'success', data: { item: result.rows[0] } });
    } catch (error) {
        next(error);
    }
};

export const getItems = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId } = req.query;

    try {
        const result = await query(
            `SELECT i.*, u.symbol as unit_symbol 
             FROM items i 
             LEFT JOIN units u ON i.unit_id = u.id 
             WHERE i.company_id = $1 
             ORDER BY i.name`,
            [companyId]
        );
        res.status(200).json({ status: 'success', data: { items: result.rows } });
    } catch (error) {
        next(error);
    }
};

export const updateItem = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { name, hsnCode, unitId, taxRate, salesRate, purchaseRate } = req.body;

    try {
        const result = await query(
            `UPDATE items 
             SET name = $1, hsn_code = $2, unit_id = $3, 
                 tax_rate = $4, sales_rate = $5, purchase_rate = $6
             WHERE id = $7 RETURNING *`,
            [name, hsnCode, unitId, taxRate, salesRate, purchaseRate, id]
        );

        if (result.rows.length === 0) {
            return next(new AppError('Item not found', 404));
        }

        res.status(200).json({ status: 'success', data: { item: result.rows[0] } });
    } catch (error) {
        next(error);
    }
};

export const deleteItem = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        await query('DELETE FROM items WHERE id = $1', [id]);
        res.status(204).json({ status: 'success', data: null });
    } catch (error) {
        next(error);
    }
};
