import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { ASSET_KINDS, AssetKind, deleteAsset, getAsset, saveAsset } from '../services/assetService';
import * as companies from '../services/companyService';

export const createCompany = async (req: Request, res: Response) => {
    const company = await companies.createCompany(req.user!.id, req.body);
    res.status(201).json({ status: 'success', data: { company: { ...company, role: 'admin' } } });
};

export const getCompanies = async (req: Request, res: Response) => {
    const list = await companies.listCompaniesForUser(req.user!.id);
    res.status(200).json({ status: 'success', results: list.length, data: { companies: list } });
};

export const getCompany = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { company: await companies.getCompanyProfile(req.company!.id, req.company!.role) } });
};

const assetKind = (req: Request): AssetKind => {
    const k = req.params.kind as AssetKind;
    if (!ASSET_KINDS.includes(k)) throw new AppError('Unknown image type', 404);
    return k;
};

/** PUT /companies/:companyId/assets/:kind  { dataUrl } */
export const uploadCompanyAsset = async (req: Request, res: Response) => {
    await saveAsset(req.company!.id, assetKind(req), String(req.body?.dataUrl || ''), req.user!.id);
    res.status(200).json({ status: 'success' });
};

export const removeCompanyAsset = async (req: Request, res: Response) => {
    await deleteAsset(req.company!.id, assetKind(req));
    res.status(204).send();
};

export const getCompanyAsset = async (req: Request, res: Response) => {
    const a = await getAsset(req.company!.id, assetKind(req));
    if (!a) throw new AppError('No image uploaded', 404);
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(a.data);
};

export const updateCompany = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { company: await companies.updateCompany(req.company!.id, req.body) } });
};
