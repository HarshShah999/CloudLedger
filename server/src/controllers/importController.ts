import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { excelTemplate, importExcel, importTally, ExcelKind } from '../services/importService';
import { getImportJob, startImportJob } from '../services/importJobs';

// Tally writes UTF-16, so a few years of Day Book can be tens of MB
const MAX_BYTES = 80 * 1024 * 1024;

/** Files arrive as base64 in JSON (keeps the API simple). */
const fileFrom = (req: Request) => {
    const b64 = String(req.body?.fileBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!b64) throw new AppError('Choose a file to import', 400);
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) throw new AppError('The file is empty', 400);
    if (buf.length > MAX_BYTES) throw new AppError('File is too large (max 80 MB). Export the Day Book one year at a time.', 400);
    return buf;
};

const dryRun = (req: Request) => req.body?.commit !== true;

/**
 * POST /api/import/tally { companyId, fileBase64, commit?, background? } — preview unless commit is true.
 * With background: true it returns a job id at once; poll GET /api/import/jobs/:jobId.
 */
export const postTallyImport = async (req: Request, res: Response) => {
    const file = fileFrom(req);
    const companyId = req.company!.id;
    if (req.body?.background === true) {
        const job = await startImportJob(companyId, req.user!.id, dryRun(req), (onProgress) => importTally(companyId, file, dryRun(req), onProgress));
        res.status(202).json({ status: 'success', data: { jobId: job.id } });
        return;
    }
    res.json({ status: 'success', data: await importTally(companyId, file, dryRun(req)) });
};

/** GET /api/import/jobs/:jobId — progress, then the report. */
export const getImportJobStatus = async (req: Request, res: Response) => {
    const job = await getImportJob(String(req.params.jobId), req.user!.id);
    // Status values are lower-case in the API (running / done / failed)
    res.json({ status: 'success', data: { ...job, status: job.status.toLowerCase() } });
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
