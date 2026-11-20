/**
 * Stock movements and valuation (weighted average cost, as Tally does by default).
 *
 * - Opening stock: item.opening_quantity x item.opening_rate, at the start of the books.
 * - Purchases come in at their taxable value (cost excluding GST).
 * - Sales, purchase returns and sales returns move at the running average cost.
 * Closing stock value feeds the Profit & Loss (opening/closing stock) and the Balance Sheet.
 */
import { query, Queryable } from '../config/db';
import { fromPaise, toPaise } from '../utils/money';

const SIGN: Record<string, number> = { SALES: -1, DEBIT_NOTE: -1, PURCHASE: 1, CREDIT_NOTE: 1 };

/**
 * Rewrites the stock movements of one bill from its lines. Call after the lines
 * are saved (create, edit, cancel, delete). Quotations, orders, opening bills,
 * cancelled bills and services move no stock.
 */
export const syncInvoiceStock = async (db: Queryable, invoiceId: string) => {
    await db.query('DELETE FROM stock_movements WHERE invoice_id = $1', [invoiceId]);
    await db.query(
        `INSERT INTO stock_movements (company_id, item_id, invoice_id, date, quantity, value)
         SELECT i.company_id, ii.item_id, i.id, i.date,
                CASE WHEN i.type IN ('PURCHASE', 'CREDIT_NOTE') THEN ii.quantity ELSE -ii.quantity END,
                CASE WHEN i.type = 'PURCHASE' THEN ii.taxable_amount END
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
         JOIN items it ON it.id = ii.item_id
         WHERE i.id = $1 AND i.type = ANY($2) AND NOT i.is_opening
           AND COALESCE(i.status, '') <> 'CANCELLED'
           AND COALESCE(it.item_type, 'GOODS') = 'GOODS' AND ii.quantity <> 0`,
        [invoiceId, Object.keys(SIGN)]
    );
};

export interface ItemStock {
    item_id: string;
    name: string;
    unit: string | null;
    quantity: number;
    rate: number; // average cost per unit
    value: number;
}

/**
 * Quantity and value of every stocked item, either up to and including `asOf`
 * or (with `before`) strictly before it. Opening stock is always included.
 */
export const stockPosition = async (db: Queryable, companyId: string, asOf: string, { before = false } = {}): Promise<ItemStock[]> => {
    const items = (
        await db.query(
            `SELECT i.id, i.name, i.opening_quantity, i.opening_rate, i.purchase_rate, u.symbol AS unit
             FROM items i LEFT JOIN units u ON u.id = i.unit_id
             WHERE i.company_id = $1 AND COALESCE(i.item_type, 'GOODS') = 'GOODS'
             ORDER BY i.name`,
            [companyId]
        )
    ).rows;
    const moves = (
        await db.query(
            `SELECT item_id, quantity, value FROM stock_movements
             WHERE company_id = $1 AND date ${before ? '<' : '<='} $2
             ORDER BY date, created_at, id`,
            [companyId, asOf]
        )
    ).rows;
    const byItem = new Map<string, { quantity: string; value: string | null }[]>();
    for (const m of moves) {
        if (!byItem.has(m.item_id)) byItem.set(m.item_id, []);
        byItem.get(m.item_id)!.push(m);
    }

    return items
        .map((it) => {
            // Quantities in thousandths, values in paise: exact integer arithmetic
            let qty = Math.round(Number(it.opening_quantity) * 1000);
            let value = Math.round(Number(it.opening_quantity) * Number(it.opening_rate) * 100);
            let lastRate = Number(it.opening_rate) || Number(it.purchase_rate) || 0; // rupees per unit
            for (const m of byItem.get(it.id) ?? []) {
                const q = Math.round(Number(m.quantity) * 1000);
                if (q > 0 && m.value != null) {
                    value += toPaise(m.value);
                    qty += q;
                    if (q) lastRate = fromPaise(toPaise(m.value)) / (q / 1000);
                } else {
                    // Moves at the current average cost (or the last known cost when stock is not positive)
                    const avg = qty > 0 && value > 0 ? value / 100 / (qty / 1000) : lastRate;
                    value += Math.round((q / 1000) * avg * 100);
                    qty += q;
                }
                if (qty <= 0) {
                    value = 0; // nothing left to value; negative stock carries no value
                } else {
                    lastRate = value / 100 / (qty / 1000);
                }
            }
            const quantity = qty / 1000;
            const v = qty > 0 ? Math.max(value, 0) : 0;
            return {
                item_id: it.id,
                name: it.name,
                unit: it.unit,
                quantity,
                rate: qty > 0 ? Math.round((v / 100 / quantity) * 100) / 100 : 0,
                value: fromPaise(v),
            };
        });
};

/** Total stock value in paise (see stockPosition). */
export const stockValuePaise = async (db: Queryable, companyId: string, asOf: string, opts: { before?: boolean } = {}) =>
    (await stockPosition(db, companyId, asOf, opts)).reduce((s, i) => s + toPaise(i.value), 0);

/** Value of opening stock at the start of the books (before any movement). */
export const openingStockPaise = async (db: Queryable, companyId: string) =>
    toPaise(
        (
            await db.query(
                `SELECT COALESCE(SUM(ROUND(opening_quantity * opening_rate, 2)), 0) AS v FROM items
                 WHERE company_id = $1 AND COALESCE(item_type, 'GOODS') = 'GOODS'`,
                [companyId]
            )
        ).rows[0].v
    );

/** Stock summary report: quantity, average cost and value per item as on a date. */
export const stockSummary = async (companyId: string, asOf: string) => {
    const rows = await stockPosition({ query }, companyId, asOf);
    return {
        asOf,
        items: rows,
        totalValue: fromPaise(rows.reduce((s, r) => s + toPaise(r.value), 0)),
    };
};
