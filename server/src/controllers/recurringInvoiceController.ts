import { Request, Response } from 'express';
import { withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { generateDueInvoices, listRecurring, saveRecurring, setTemplateActive, deleteTemplate } from '../services/recurringService';

export const getRecurringInvoices = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { recurringInvoices: await listRecurring(req.company!.id) } });
};

export const getRecurringInvoice = async (req: Request, res: Response) => {
    const [row] = await listRecurring(req.company!.id, req.params.id);
    if (!row) throw new AppError('Recurring invoice not found', 404);
    res.status(200).json({ status: 'success', data: { recurringInvoice: row } });
};

export const createRecurringInvoice = async (req: Request, res: Response) => {
    const row = await withTransaction((db) => saveRecurring(db, req.company!.id, req.body));
    res.status(201).json({ status: 'success', data: { recurringInvoice: row } });
};

export const updateRecurringInvoice = async (req: Request, res: Response) => {
    const row = await withTransaction((db) => saveRecurring(db, req.company!.id, req.body, req.params.id));
    res.status(200).json({ status: 'success', data: { recurringInvoice: row } });
};

/** PATCH: pause / resume only. */
export const setRecurringActive = async (req: Request, res: Response) => {
    const isActive = req.body.isActive ?? req.body.is_active;
    if (typeof isActive !== 'boolean') throw new AppError('isActive must be true or false', 400);
    res.status(200).json({ status: 'success', data: { recurringInvoice: await setTemplateActive(req.params.id, isActive) } });
};

export const deleteRecurringInvoice = async (req: Request, res: Response) => {
    await deleteTemplate(req.params.id);
    res.status(204).send();
};

/** Generate now any invoices that are due for this template. */
export const runRecurringNow = async (req: Request, res: Response) => {
    const generated = await generateDueInvoices(req.params.id);
    res.status(200).json({ status: 'success', data: { generated } });
};
