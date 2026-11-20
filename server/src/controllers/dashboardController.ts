import { Request, Response } from 'express';
import { dashboardStats } from '../services/dashboardService';

export const getDashboardStats = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: await dashboardStats(req.company!.id) });
};
