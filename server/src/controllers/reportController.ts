import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { balanceSheet, ledgerStatement, profitAndLoss, trialBalance, fyStartFor } from '../services/reportService';
import { query } from '../config/db';
import { toDateString } from '../services/financialYear';
import { ageing, dayBook } from '../services/outstandingService';
import { stockSummary } from '../services/stockService';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads a period from the query, defaulting to the current financial year to date. */
export const readPeriod = async (req: Request) => {
    const to = String(req.query.endDate || req.query.toDate || toDateString(new Date())).slice(0, 10);
    const from = String(req.query.startDate || req.query.fromDate || (await fyStartFor({ query }, req.company!.id, to))).slice(0, 10);
    if (!DATE.test(from) || !DATE.test(to)) throw new AppError('Dates must be in YYYY-MM-DD format', 400);
    if (from > to) throw new AppError('Start date must be before end date', 400);
    return { from, to };
};

export const getTrialBalance = async (req: Request, res: Response) => {
    const { from, to } = await readPeriod(req);
    const tb = await trialBalance(req.company!.id, from, to);
    res.status(200).json({ status: 'success', data: { ...tb, period: { from, to } } });
};

export const getPnL = async (req: Request, res: Response) => {
    const { from, to } = await readPeriod(req);
    res.status(200).json({ status: 'success', data: { ...(await profitAndLoss(req.company!.id, from, to)), period: { from, to } } });
};

export const getBalanceSheet = async (req: Request, res: Response) => {
    const asOf = String(req.query.asOfDate || toDateString(new Date())).slice(0, 10);
    if (!DATE.test(asOf)) throw new AppError('asOfDate must be in YYYY-MM-DD format', 400);
    res.status(200).json({ status: 'success', data: { ...(await balanceSheet(req.company!.id, asOf)), asOfDate: asOf } });
};

export const getLedgerStatement = async (req: Request, res: Response) => {
    const from = req.query.startDate ? String(req.query.startDate).slice(0, 10) : null;
    const to = req.query.endDate ? String(req.query.endDate).slice(0, 10) : null;
    const result = await ledgerStatement(req.company!.id, req.params.ledgerId, from, to);
    if (!result) throw new AppError('Ledger not found', 404);
    res.status(200).json({ status: 'success', data: result });
};

export const getAgeing = async (req: Request, res: Response) => {
    const kind = String(req.query.kind || 'receivable');
    if (kind !== 'receivable' && kind !== 'payable') throw new AppError('kind must be receivable or payable', 400);
    const asOf = String(req.query.asOfDate || toDateString(new Date())).slice(0, 10);
    if (!DATE.test(asOf)) throw new AppError('asOfDate must be in YYYY-MM-DD format', 400);
    res.json({ status: 'success', data: await ageing(req.company!.id, kind, asOf) });
};

export const getDayBook = async (req: Request, res: Response) => {
    const { from, to } = await readPeriod(req);
    const vt = req.query.voucherTypeId ? String(req.query.voucherTypeId) : undefined;
    res.json({ status: 'success', data: await dayBook(req.company!.id, from, to, vt) });
};

/** GET /api/reports/stock-summary?asOfDate= — quantity, average cost and value per item. */
export const getStockSummary = async (req: Request, res: Response) => {
    const asOf = String(req.query.asOfDate || toDateString(new Date())).slice(0, 10);
    if (!DATE.test(asOf)) throw new AppError('asOfDate must be in YYYY-MM-DD format', 400);
    res.json({ status: 'success', data: await stockSummary(req.company!.id, asOf) });
};
