import { Request, Response } from 'express';
import { companyExportPath, exportCompanyData, importCompanyData, listCompanyExports } from '../services/companyCopyService';

/** POST /api/backup/company/:companyId/export */
export const exportCompany = async (req: Request, res: Response) => {
    const data = await exportCompanyData(req.params.companyId, req.user!.id);
    res.status(200).json({ status: 'success', message: 'Company exported successfully', data });
};

/** POST /api/backup/company/import { companyData } */
export const importCompany = async (req: Request, res: Response) => {
    const data = await importCompanyData(req.user!.id, req.body.companyData);
    res.status(200).json({ status: 'success', message: 'Company imported successfully', data });
};

export const getCompanyExports = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: await listCompanyExports(req.user!.id) });
};

export const downloadCompanyExport = async (req: Request, res: Response) => {
    const { filepath, filename } = await companyExportPath(req.user!.id, String(req.params.filename));
    res.download(filepath, filename);
};
