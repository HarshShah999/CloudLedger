import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { excelTemplate, importExcel, importTally, ExcelKind } from '../services/importService';

const MAX_BYTES = 15 * 1024 * 1024;

/** Files arrive as base64 in JSON (keeps the API simple; the body limit is 25 MB). */
const fileFrom = (req: Request) => {
    const b64 = String(req.body?.fileBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!b64) throw new AppError('Choose a file to import', 400);
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) throw new AppError('The file is empty', 400);
    if (buf.length > MAX_BYTES) throw new AppError('File is too large (max 15 MB)', 400);
    return buf;
};

const dryRun = (req: Request) => req.body?.commit !== true;

/** POST /api/import/tally { companyId, fileBase64, commit? } — preview unless commit is true. */
export const postTallyImport = async (req: Request, res: Response) => {
    res.json({ status: 'success', data: await importTally(req.company!.id, fileFrom(req), dryRun(req)) });
};

const kind = (req: Request): ExcelKind => {
    const k = req.params.kind;
    if (k !== 'ledgers' && k !== 'items') throw new AppError('Unknown import type', 404);
    return k;
};

export const postExcelImport = async (req: Request, res: Response) => {
    res.json({ status: 'success', data: await importExcel(req.company!.id, kind(req), fileFrom(req), dryRun(req)) });
};

export const getExcelTemplate = async (req: Request, res: Response) => {
    const k = kind(req);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cloudledger-${k}-template.xlsx"`);
    res.send(await excelTemplate(k));
};
