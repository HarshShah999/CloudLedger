import { Request, Response } from 'express';
import * as ledgers from '../services/ledgerService';

/* ---------- Groups ---------- */

export const getGroups = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { groups: await ledgers.listGroups(req.company!.id) } });
};

export const createGroup = async (req: Request, res: Response) => {
    res.status(201).json({ status: 'success', data: { group: await ledgers.createGroup(req.company!.id, req.body) } });
};

/* ---------- Ledgers ---------- */

export const getLedgers = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { ledgers: await ledgers.listLedgers(req.company!.id) } });
};

export const createLedger = async (req: Request, res: Response) => {
    res.status(201).json({ status: 'success', data: { ledger: await ledgers.createLedger(req.company!.id, req.body) } });
};

export const updateLedger = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { ledger: await ledgers.updateLedger(req.company!.id, req.params.id, req.body) } });
};

export const deleteLedger = async (req: Request, res: Response) => {
    await ledgers.deleteLedger(req.company!.id, req.params.id);
    res.status(204).send();
};
