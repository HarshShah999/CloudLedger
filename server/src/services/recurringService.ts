import { Queryable, query, withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { createInvoice, InvoiceType } from './invoiceService';
import { toDateString } from './financialYear';
import { logger } from '../config/logger';

export type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';

/** Adds one period to a YYYY-MM-DD date, clamping to month end (31 Jan + 1 month = 28/29 Feb). */
export const addPeriod = (date: string, frequency: Frequency): string => {
    const [y, m, d] = date.split('-').map(Number);
    if (frequency === 'WEEKLY') {
        const dt = new Date(Date.UTC(y, m - 1, d + 7));
        return dt.toISOString().slice(0, 10);
    }
    const months = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 }[frequency];
    const total = y * 12 + (m - 1) + months;
    const ny = Math.floor(total / 12);
    const nm = total % 12;
    const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
};

export interface RecurringInput {
    profileName?: string | null;
    partyLedgerId: string;
    salesLedgerId: string;
    type: InvoiceType;
    frequency: Frequency;
    startDate: string;
    endDate?: string | null;
    nextInvoiceDate?: string | null;
    dueInDays?: number;
    discountPercent?: number;
    notes?: string | null;
    isActive?: boolean;
    items: { itemId?: string | null; description?: string | null; quantity: number; rate: number; taxRate?: number; discountPercent?: number }[];
}

export const saveRecurring = async (db: Queryable, companyId: string, input: RecurringInput, id?: string) => {
    const owned = await db.query('SELECT id FROM ledgers WHERE company_id = $1 AND id = ANY($2::uuid[])', [
        companyId,
        [input.partyLedgerId, input.salesLedgerId],
    ]);
    if (owned.rows.length !== new Set([input.partyLedgerId, input.salesLedgerId]).size) {
        throw new AppError('Ledgers do not belong to this company', 400);
    }
    const next = input.nextInvoiceDate || input.startDate;
    const values = [
        input.profileName || null, input.partyLedgerId, input.salesLedgerId, input.type, input.frequency,
        input.startDate, input.endDate || null, next, Number(input.discountPercent || 0), input.notes || null,
        input.isActive ?? true,
    ];

    let row;
    if (id) {
        row = (
            await db.query(
                `UPDATE recurring_invoices SET profile_name = $1, party_ledger_id = $2, sales_ledger_id = $3, type = $4,
                     frequency = $5, start_date = $6, end_date = $7, next_invoice_date = $8, discount_percent = $9,
                     notes = $10, is_active = $11, updated_at = NOW()
                 WHERE id = $12 AND company_id = $13 RETURNING *`,
                [...values, id, companyId]
            )
        ).rows[0];
        if (!row) throw new AppError('Recurring invoice not found', 404);
        await db.query('DELETE FROM recurring_invoice_items WHERE recurring_invoice_id = $1', [id]);
    } else {
        row = (
            await db.query(
                `INSERT INTO recurring_invoices (profile_name, party_ledger_id, sales_ledger_id, type, frequency,
                     start_date, end_date, next_invoice_date, discount_percent, notes, is_active, company_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
                [...values, companyId]
            )
        ).rows[0];
    }

    for (const it of input.items) {
        await db.query(
            `INSERT INTO recurring_invoice_items (recurring_invoice_id, item_id, description, quantity, rate, tax_rate, discount_percent)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [row.id, it.itemId || null, it.description || null, it.quantity, it.rate, it.taxRate ?? null, it.discountPercent || 0]
        );
    }
    return row;
};

/** Lists templates with their items attached. */
export const listRecurring = async (companyId: string, id?: string) => {
    const params: any[] = [companyId];
    let sql = `SELECT r.*, l.name AS party_name FROM recurring_invoices r
               LEFT JOIN ledgers l ON r.party_ledger_id = l.id WHERE r.company_id = $1`;
    if (id) {
        params.push(id);
        sql += ' AND r.id = $2';
    }
    const rows = (await query(sql + ' ORDER BY r.created_at DESC', params)).rows;
    if (!rows.length) return rows;
    const items = await query(
        `SELECT ri.*, COALESCE(ri.tax_rate, it.tax_rate, 0) AS tax_rate
         FROM recurring_invoice_items ri LEFT JOIN items it ON it.id = ri.item_id
         WHERE ri.recurring_invoice_id = ANY($1::uuid[])`,
        [rows.map((r) => r.id)]
    );
    return rows.map((r) => ({ ...r, items: items.rows.filter((i) => i.recurring_invoice_id === r.id) }));
};

/**
 * Generates every invoice that is due up to `today` for one template, catching
 * up on missed periods. Each invoice is its own transaction.
 */
export const generateDueInvoices = async (templateId: string, today = toDateString(new Date())): Promise<number> => {
    let generated = 0;
    for (let guard = 0; guard < 120; guard++) {
        const done = await withTransaction(async (db) => {
            const t = (await db.query('SELECT * FROM recurring_invoices WHERE id = $1 FOR UPDATE', [templateId])).rows[0];
            if (!t || !t.is_active) return false;
            const due = toDateString(t.next_invoice_date);
            if (due > today || (t.end_date && due > toDateString(t.end_date))) return false;

            const items = (
                await db.query(
                    `SELECT ri.*, COALESCE(ri.tax_rate, it.tax_rate, 0) AS effective_tax
                     FROM recurring_invoice_items ri LEFT JOIN items it ON it.id = ri.item_id
                     WHERE ri.recurring_invoice_id = $1`,
                    [templateId]
                )
            ).rows;
            if (!items.length) throw new AppError('Template has no items', 400);

            const inv = await createInvoice(db, t.company_id, {
                partyLedgerId: t.party_ledger_id,
                salesLedgerId: t.sales_ledger_id,
                date: due,
                dueDate: due,
                type: t.type,
                notes: t.notes,
                discountPercent: Number(t.discount_percent || 0),
                items: items.map((i) => ({
                    itemId: i.item_id,
                    description: i.description,
                    quantity: Number(i.quantity),
                    rate: Number(i.rate),
                    taxRate: Number(i.effective_tax),
                    discountPercent: Number(i.discount_percent || 0),
                })),
            });
            await db.query('UPDATE invoices SET recurring_invoice_id = $1 WHERE id = $2', [templateId, inv.id]);
            await db.query(
                `UPDATE recurring_invoices SET next_invoice_date = $1, last_generated_at = NOW(), last_error = NULL WHERE id = $2`,
                [addPeriod(due, t.frequency), templateId]
            );
            return true;
        });
        if (!done) break;
        generated++;
    }
    return generated;
};

export const runRecurringInvoices = async (today = toDateString(new Date())) => {
    const due = await query(
        `SELECT id FROM recurring_invoices WHERE is_active AND next_invoice_date <= $1
         AND (end_date IS NULL OR next_invoice_date <= end_date)`,
        [today]
    );
    let total = 0;
    for (const { id } of due.rows) {
        try {
            total += await generateDueInvoices(id, today);
        } catch (err) {
            logger.error({ err: (err as Error).message }, `Recurring invoice ${id} failed:`);
            await query('UPDATE recurring_invoices SET last_error = $1 WHERE id = $2', [(err as Error).message, id]);
        }
    }
    return total;
};

/** Pauses or resumes a recurring invoice template. */
export const setTemplateActive = async (id: string, isActive: boolean) =>
    (await query('UPDATE recurring_invoices SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [isActive, id])).rows[0];

export const deleteTemplate = async (id: string) => {
    await query('DELETE FROM recurring_invoices WHERE id = $1', [id]);
};
