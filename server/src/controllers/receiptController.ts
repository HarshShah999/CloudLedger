import { Request, Response } from 'express';
import { withTransaction, query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { isUuid } from '../middleware/companyAccess';
import { allocateReceipt, createReceipt, deleteReceipt, listReceipts, openInvoices, Direction } from '../services/receiptService';

export const getReceipts = async (req: Request, res: Response) => {
    const rows = await listReceipts(req.company!.id, {
        partyLedgerId: isUuid(req.query.partyLedgerId) ? req.query.partyLedgerId : undefined,
        direction: req.query.direction ? String(req.query.direction).toUpperCase() : undefined,
        onlyUnallocated: req.query.unallocated === 'true',
    });
    res.json({ status: 'success', data: { receipts: rows } });
};

export const postReceipt = async (req: Request, res: Response) => {
    const receipt = await withTransaction((db) => createReceipt(db, req.company!.id, req.body));
    res.status(201).json({ status: 'success', data: { receipt } });
};

export const postAllocation = async (req: Request, res: Response) => {
    await withTransaction((db) => allocateReceipt(db, req.company!.id, req.params.id, req.body.allocations || []));
    res.json({ status: 'success' });
};

export const removeReceipt = async (req: Request, res: Response) => {
    await withTransaction((db) => deleteReceipt(db, req.company!.id, req.params.id));
    res.status(204).send();
};

/** GET /api/receipts/open-invoices?partyLedgerId&direction — what this party can settle. */
export const getOpenInvoices = async (req: Request, res: Response) => {
    const partyLedgerId = req.query.partyLedgerId;
    const direction = String(req.query.direction || 'RECEIPT').toUpperCase() as Direction;
    if (!isUuid(partyLedgerId)) throw new AppError('partyLedgerId is required', 400);
    if (direction !== 'RECEIPT' && direction !== 'PAYMENT') throw new AppError('Invalid direction', 400);
    const invoices = await openInvoices({ query }, req.company!.id, partyLedgerId, direction);
    const advances = await listReceipts(req.company!.id, { partyLedgerId, direction, onlyUnallocated: true });
    res.json({ status: 'success', data: { invoices, advances } });
};
