import { Request, Response } from 'express';
import { query } from '../config/db';
import { isPeriodLocked } from '../services/financialYear';
import * as fy from '../services/financialYearService';

export const getFinancialYears = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { financialYears: await fy.listFinancialYears(req.company!.id) } });
};

export const getActiveFinancialYear = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { financialYear: await fy.getActiveFinancialYear(req.company!.id) } });
};

export const createFinancialYear = async (req: Request, res: Response) => {
    res.status(201).json({ status: 'success', data: { financialYear: await fy.createFinancialYear(req.company!.id, req.body) } });
};

export const activateFinancialYear = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { financialYear: await fy.activateFinancialYear(req.company!.id, req.params.id) } });
};

/** Closing a year locks it: no vouchers/invoices can be created, edited or deleted in it. */
export const closeFinancialYear = async (req: Request, res: Response) => {
    const financialYear = await fy.closeFinancialYear(req.company!.id, req.params.id);
    res.status(200).json({ status: 'success', message: 'Financial year closed', data: { financialYear } });
};

export const reopenFinancialYear = async (req: Request, res: Response) => {
    const financialYear = await fy.reopenFinancialYear(req.company!.id, req.params.id);
    res.status(200).json({ status: 'success', message: 'Financial year reopened', data: { financialYear } });
};

export const deleteFinancialYear = async (req: Request, res: Response) => {
    await fy.deleteFinancialYear(req.company!.id, req.params.id);
    res.status(204).send();
};

/** @deprecated use services/financialYear.isPeriodLocked */
export const checkPeriodLocked = (companyId: string, date: string) => isPeriodLocked({ query }, companyId, date);
