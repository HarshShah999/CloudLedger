import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { bankTransactions, setBankDate } from '../services/reconciliationService';

export const getBankTransactions = async (req: Request, res: Response) => {
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) throw new AppError('fromDate and toDate are required', 400);
    const transactions = await bankTransactions(req.company!.id, req.params.ledgerId, String(fromDate), String(toDate));
    res.status(200).json({ status: 'success', results: transactions.length, data: { transactions } });
};

export const updateReconciliation = async (req: Request, res: Response) => {
    const { bankAllocationDate } = req.body;
    if (bankAllocationDate && !/^\d{4}-\d{2}-\d{2}/.test(bankAllocationDate)) {
        throw new AppError('bankAllocationDate must be YYYY-MM-DD', 400);
    }
    const transaction = await setBankDate(req.params.id, bankAllocationDate ? String(bankAllocationDate).slice(0, 10) : null);
    res.status(200).json({ status: 'success', data: { transaction } });
};
