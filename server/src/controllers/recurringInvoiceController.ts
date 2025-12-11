import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

export const createRecurringInvoice = async (req: Request, res: Response, next: NextFunction) => {
    const {
        companyId, partyLedgerId, salesLedgerId,
        type, frequency, startDate, endDate,
        invoiceNumberPrefix, notes, discountPercent = 0,
        items
    } = req.body;

    if (!items || items.length === 0) {
        return next(new AppError('Recurring invoice must have items', 400));
    }

    try {
        await query('BEGIN');

        // Calculate next invoice date (initially start date)
        const nextInvoiceDate = startDate;

        // Create Recurring Invoice Header
        const recurringRes = await query(
            `INSERT INTO recurring_invoices (
                company_id, party_ledger_id, sales_ledger_id,
                type, frequency, start_date, end_date, next_invoice_date,
                invoice_number_prefix, notes, discount_percent, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true) RETURNING *`,
            [companyId, partyLedgerId, salesLedgerId, type, frequency, startDate, endDate, nextInvoiceDate,
                invoiceNumberPrefix, notes, discountPercent]
        );
        const recurringInvoice = recurringRes.rows[0];

        // Create Items
        for (const item of items) {
            await query(
                `INSERT INTO recurring_invoice_items (
                    recurring_invoice_id, item_id, description, quantity, rate, discount_percent
                ) VALUES ($1, $2, $3, $4, $5, $6)`,
                [recurringInvoice.id, item.itemId, item.description, item.quantity, item.rate, item.discountPercent || 0]
            );
        }

        await query('COMMIT');
        res.status(201).json({ status: 'success', data: { recurringInvoice } });
    } catch (error) {
        await query('ROLLBACK');
        next(error);
    }
};

export const getRecurringInvoices = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId } = req.query;

    try {
        const result = await query(
            `SELECT r.*, l.name as party_name 
             FROM recurring_invoices r
             LEFT JOIN ledgers l ON r.party_ledger_id = l.id
             WHERE r.company_id = $1
             ORDER BY r.created_at DESC`,
            [companyId]
        );
        res.status(200).json({ status: 'success', data: { recurringInvoices: result.rows } });
    } catch (error) {
        next(error);
    }
};

export const deleteRecurringInvoice = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        await query('DELETE FROM recurring_invoices WHERE id = $1', [id]);
        res.status(204).json({ status: 'success', data: null });
    } catch (error) {
        next(error);
    }
};

export const updateRecurringInvoice = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { isActive } = req.body;

    try {
        const result = await query(
            'UPDATE recurring_invoices SET is_active = $1 WHERE id = $2 RETURNING *',
            [isActive, id]
        );

        if (result.rows.length === 0) {
            return next(new AppError('Recurring invoice not found', 404));
        }

        res.status(200).json({ status: 'success', data: { recurringInvoice: result.rows[0] } });
    } catch (error) {
        next(error);
    }
};
