import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import * as paymentService from '../services/paymentService';

export const createPayment = async (req: Request, res: Response) => {
    const payment = await withTransaction((db) => paymentService.createPayment(db, req.company!.id, req.body));
    res.status(201).json({ status: 'success', data: { payment } });
};

export const getPayments = async (req: Request, res: Response) => {
    const params: any[] = [req.company!.id];
    let sql = `SELECT p.*, i.invoice_number, l.name AS deposit_ledger_name
               FROM payments p
               LEFT JOIN invoices i ON i.id = p.invoice_id
               LEFT JOIN ledgers l ON l.id = p.deposit_ledger_id
               WHERE p.company_id = $1`;
    if (req.query.invoiceId) {
        params.push(req.query.invoiceId);
        sql += ` AND p.invoice_id = $${params.length}`;
    }
    sql += ' ORDER BY p.payment_date DESC, p.created_at DESC';
    const result = await query(sql, params);
    res.status(200).json({ status: 'success', data: { payments: result.rows } });
};

export const deletePayment = async (req: Request, res: Response) => {
    await withTransaction((db) => paymentService.deletePayment(db, req.company!.id, req.params.id));
    res.status(204).send();
};
