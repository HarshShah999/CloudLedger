/** Units and items (stock and service masters). */
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { uqcFor } from '../utils/gst';

/* ---------- Units ---------- */

export const createUnit = async (companyId: string, input: { name: string; symbol: string; uqc?: string | null }) => {
    try {
        return (
            await query('INSERT INTO units (company_id, name, symbol, uqc) VALUES ($1, $2, $3, $4) RETURNING *', [
                companyId, input.name, input.symbol, uqcFor(input.uqc, input.symbol),
            ])
        ).rows[0];
    } catch (error: any) {
        if (error.code === '23505') throw new AppError('Unit with this name already exists', 400);
        throw error;
    }
};

export const listUnits = async (companyId: string) => (await query('SELECT * FROM units WHERE company_id = $1 ORDER BY name', [companyId])).rows;

export const deleteUnit = async (companyId: string, id: string) => {
    const used = await query('SELECT 1 FROM items WHERE unit_id = $1 LIMIT 1', [id]);
    if (used.rows.length) throw new AppError('This unit is used by items', 400);
    await query('DELETE FROM units WHERE id = $1 AND company_id = $2', [id, companyId]);
};

/* ---------- Items ---------- */

const assertUnit = async (companyId: string, unitId?: string | null) => {
    if (!unitId) return;
    const r = await query('SELECT 1 FROM units WHERE id = $1 AND company_id = $2', [unitId, companyId]);
    if (!r.rows.length) throw new AppError('Unit not found in this company', 400);
};

export const createItem = async (companyId: string, b: any) => {
    await assertUnit(companyId, b.unitId);
    return (
        await query(
            `INSERT INTO items (company_id, name, hsn_code, unit_id, tax_rate, sales_rate, purchase_rate,
                                opening_quantity, current_quantity, description, item_type, opening_rate)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11) RETURNING *`,
            [
                companyId, b.name, b.hsnCode || null, b.unitId || null, b.taxRate || 0, b.salesRate || 0,
                b.purchaseRate || 0, b.openingQuantity || 0, b.description || null, b.itemType || 'GOODS',
                // Opening stock is valued at its cost; the purchase rate is the usual default
                b.openingRate ?? b.purchaseRate ?? 0,
            ]
        )
    ).rows[0];
};

export const listItems = async (companyId: string) =>
    (
        await query(
            `SELECT i.*, u.symbol AS unit_symbol FROM items i
             LEFT JOIN units u ON i.unit_id = u.id
             WHERE i.company_id = $1 ORDER BY i.name`,
            [companyId]
        )
    ).rows;

/** Updates an item; opening stock can be corrected later and current stock follows automatically. */
export const updateItem = async (companyId: string, id: string, b: any) => {
    await assertUnit(companyId, b.unitId);
    const r = await query(
        `UPDATE items SET name = $1, hsn_code = $2, unit_id = $3, tax_rate = $4, sales_rate = $5,
                purchase_rate = $6, description = $7, item_type = $10,
                opening_quantity = COALESCE($11, opening_quantity), opening_rate = COALESCE($12, opening_rate)
         WHERE id = $8 AND company_id = $9 RETURNING *`,
        [
            b.name, b.hsnCode || null, b.unitId || null, b.taxRate || 0, b.salesRate || 0, b.purchaseRate || 0,
            b.description || null, id, companyId, b.itemType || 'GOODS', b.openingQuantity ?? null, b.openingRate ?? null,
        ]
    );
    if (!r.rows.length) throw new AppError('Item not found', 404);
    return r.rows[0];
};

export const deleteItem = async (companyId: string, id: string) => {
    const used = await query('SELECT 1 FROM invoice_items WHERE item_id = $1 LIMIT 1', [id]);
    if (used.rows.length) throw new AppError('This item is used in invoices and cannot be deleted', 400);
    await query('DELETE FROM items WHERE id = $1 AND company_id = $2', [id, companyId]);
};
