import { Request, Response } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { uqcFor } from '../utils/gst';

/* ---------- Units ---------- */

export const createUnit = async (req: Request, res: Response) => {
    const { name, symbol } = req.body;
    try {
        const result = await query('INSERT INTO units (company_id, name, symbol, uqc) VALUES ($1, $2, $3, $4) RETURNING *', [
            req.company!.id,
            name,
            symbol,
            uqcFor(req.body.uqc, symbol),
        ]);
        res.status(201).json({ status: 'success', data: { unit: result.rows[0] } });
    } catch (error: any) {
        if (error.code === '23505') throw new AppError('Unit with this name already exists', 400);
        throw error;
    }
};

export const getUnits = async (req: Request, res: Response) => {
    const result = await query('SELECT * FROM units WHERE company_id = $1 ORDER BY name', [req.company!.id]);
    res.status(200).json({ status: 'success', data: { units: result.rows } });
};

export const deleteUnit = async (req: Request, res: Response) => {
    const used = await query('SELECT 1 FROM items WHERE unit_id = $1 LIMIT 1', [req.params.id]);
    if (used.rows.length) throw new AppError('This unit is used by items', 400);
    await query('DELETE FROM units WHERE id = $1 AND company_id = $2', [req.params.id, req.company!.id]);
    res.status(204).send();
};

/* ---------- Items ---------- */

const assertUnit = async (companyId: string, unitId?: string | null) => {
    if (!unitId) return;
    const r = await query('SELECT 1 FROM units WHERE id = $1 AND company_id = $2', [unitId, companyId]);
    if (!r.rows.length) throw new AppError('Unit not found in this company', 400);
};

export const createItem = async (req: Request, res: Response) => {
    const { name, hsnCode, unitId, taxRate, salesRate, purchaseRate, openingQuantity, openingRate, description, itemType } = req.body;
    await assertUnit(req.company!.id, unitId);
    const result = await query(
        `INSERT INTO items (company_id, name, hsn_code, unit_id, tax_rate, sales_rate, purchase_rate,
                            opening_quantity, current_quantity, description, item_type, opening_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11) RETURNING *`,
        [
            req.company!.id, name, hsnCode || null, unitId || null, taxRate || 0, salesRate || 0,
            purchaseRate || 0, openingQuantity || 0, description || null, itemType || 'GOODS',
            // Opening stock is valued at its cost; the purchase rate is the usual default
            openingRate ?? purchaseRate ?? 0,
        ]
    );
    res.status(201).json({ status: 'success', data: { item: result.rows[0] } });
};

export const getItems = async (req: Request, res: Response) => {
    const result = await query(
        `SELECT i.*, u.symbol AS unit_symbol FROM items i
         LEFT JOIN units u ON i.unit_id = u.id
         WHERE i.company_id = $1 ORDER BY i.name`,
        [req.company!.id]
    );
    res.status(200).json({ status: 'success', data: { items: result.rows } });
};

export const updateItem = async (req: Request, res: Response) => {
    const { name, hsnCode, unitId, taxRate, salesRate, purchaseRate, description, itemType, openingQuantity, openingRate } = req.body;
    await assertUnit(req.company!.id, unitId);
    // Opening stock can be corrected later; current stock follows automatically
    const result = await query(
        `UPDATE items SET name = $1, hsn_code = $2, unit_id = $3, tax_rate = $4, sales_rate = $5,
                purchase_rate = $6, description = $7, item_type = $10,
                opening_quantity = COALESCE($11, opening_quantity), opening_rate = COALESCE($12, opening_rate)
         WHERE id = $8 AND company_id = $9 RETURNING *`,
        [
            name, hsnCode || null, unitId || null, taxRate || 0, salesRate || 0, purchaseRate || 0,
            description || null, req.params.id, req.company!.id, itemType || 'GOODS',
            openingQuantity ?? null, openingRate ?? null,
        ]
    );
    if (!result.rows.length) throw new AppError('Item not found', 404);
    res.status(200).json({ status: 'success', data: { item: result.rows[0] } });
};

export const deleteItem = async (req: Request, res: Response) => {
    const used = await query('SELECT 1 FROM invoice_items WHERE item_id = $1 LIMIT 1', [req.params.id]);
    if (used.rows.length) throw new AppError('This item is used in invoices and cannot be deleted', 400);
    await query('DELETE FROM items WHERE id = $1 AND company_id = $2', [req.params.id, req.company!.id]);
    res.status(204).send();
};
