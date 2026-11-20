import { Request, Response } from 'express';
import * as inventory from '../services/inventoryService';

/* ---------- Units ---------- */

export const createUnit = async (req: Request, res: Response) => {
    res.status(201).json({ status: 'success', data: { unit: await inventory.createUnit(req.company!.id, req.body) } });
};

export const getUnits = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { units: await inventory.listUnits(req.company!.id) } });
};

export const deleteUnit = async (req: Request, res: Response) => {
    await inventory.deleteUnit(req.company!.id, req.params.id);
    res.status(204).send();
};

/* ---------- Items ---------- */

export const createItem = async (req: Request, res: Response) => {
    res.status(201).json({ status: 'success', data: { item: await inventory.createItem(req.company!.id, req.body) } });
};

export const getItems = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { items: await inventory.listItems(req.company!.id) } });
};

export const updateItem = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { item: await inventory.updateItem(req.company!.id, req.params.id, req.body) } });
};

export const deleteItem = async (req: Request, res: Response) => {
    await inventory.deleteItem(req.company!.id, req.params.id);
    res.status(204).send();
};
