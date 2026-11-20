import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { isUuid } from '../middleware/companyAccess';
import { auditLog, AuditFilters, recordHistory } from '../services/auditService';

/** GET /api/audit — the company's edit log, newest first, with filters and cursor paging. */
export const getAuditLog = async (req: Request, res: Response) => {
    res.json({ status: 'success', data: await auditLog(req.company!.id, req.query as AuditFilters) });
};

/** GET /api/audit/record/:recordId — every change to one document, grouped by save. */
export const getRecordHistory = async (req: Request, res: Response) => {
    const { recordId } = req.params;
    if (!isUuid(recordId)) throw new AppError('Not found', 404);
    res.json({ status: 'success', data: { history: await recordHistory(req.company!.id, recordId) } });
};
