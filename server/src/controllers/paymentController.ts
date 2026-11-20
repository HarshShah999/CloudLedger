import { Request, Response } from 'express';
import { withTransaction } from '../config/db';
import * as paymentService from '../services/paymentService';

export const createPayment = async (req: Request, res: Response) => {
    const payment = await withTransaction((db) => paymentService.createPayment(db, req.company!.id, req.body));
    res.status(201).json({ status: 'success', data: { payment } });
};

export const getPayments = async (req: Request, res: Response) => {
    const payments = await paymentService.listPayments(req.company!.id, req.query.invoiceId ? String(req.query.invoiceId) : undefined);
    res.status(200).json({ status: 'success', data: { payments } });
};

export const deletePayment = async (req: Request, res: Response) => {
    await withTransaction((db) => paymentService.deletePayment(db, req.company!.id, req.params.id));
    res.status(204).send();
};
