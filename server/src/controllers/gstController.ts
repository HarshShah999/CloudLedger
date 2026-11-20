import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { buildGstr1, buildGstr3b, tdsRegister } from '../services/gstReturns';
import { reconcileGstr2b, saveGstr2b } from '../services/gstr2bService';
import { query } from '../config/db';

const period = (req: Request) => {
    const from = String(req.query.fromDate || req.query.startDate || '').slice(0, 10);
    const to = String(req.query.toDate || req.query.endDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError('From date and To date are required', 400);
    if (from > to) throw new AppError('From date must be before To date', 400);
    return [from, to] as const;
};

export const getGSTR1 = async (req: Request, res: Response) => {
    const [from, to] = period(req);
    const { json, ...rest } = await buildGstr1(req.company!.id, from, to);
    res.json({ status: 'success', data: rest });
};

/** Downloads GSTR-1 as JSON for upload on the GST portal / offline tool. */
export const downloadGSTR1Json = async (req: Request, res: Response) => {
    const [from, to] = period(req);
    const { json } = await buildGstr1(req.company!.id, from, to);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="GSTR1_${json.gstin}_${json.fp}.json"`);
    res.send(JSON.stringify(json, null, 2));
};

export const getGSTR3B = async (req: Request, res: Response) => {
    const [from, to] = period(req);
    res.json({ status: 'success', data: await buildGstr3b(req.company!.id, from, to) });
};

export const getTdsRegister = async (req: Request, res: Response) => {
    const [from, to] = period(req);
    res.json({ status: 'success', data: await tdsRegister(req.company!.id, from, to) });
};

/** POST { fileName, content (JSON text or object), period? (MMYYYY) } */
export const uploadGSTR2B = async (req: Request, res: Response) => {
    const { content, fileName } = req.body || {};
    if (!content) throw new AppError('Choose the GSTR-2B JSON file', 400);
    const result = await saveGstr2b(req.company!.id, content, fileName || null, req.user!.id, req.body.period || undefined);
    res.status(201).json({ status: 'success', data: result });
};

export const listGSTR2B = async (req: Request, res: Response) => {
    const r = await query(
        `SELECT return_period, file_name, jsonb_array_length(documents) AS documents, created_at
         FROM gstr2b_imports WHERE company_id = $1 ORDER BY substring(return_period from 3) DESC, substring(return_period from 1 for 2) DESC`,
        [req.company!.id]
    );
    res.json({ status: 'success', data: { imports: r.rows } });
};

export const reconcileGSTR2B = async (req: Request, res: Response) => {
    const p = String(req.params.period || '');
    if (!/^\d{6}$/.test(p)) throw new AppError('Period must be MMYYYY', 400);
    res.json({ status: 'success', data: await reconcileGstr2b(req.company!.id, p) });
};
