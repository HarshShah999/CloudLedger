import { Request, Response } from 'express';
import { toDateString } from '../services/financialYear';
import * as vouchers from '../services/voucherService';

const input = (b: any): vouchers.ManualVoucherInput => ({
    voucherTypeId: b.voucherTypeId, voucherNumber: b.voucherNumber, date: b.date, narration: b.narration, entries: b.entries,
});

export const createVoucher = async (req: Request, res: Response) => {
    res.status(201).json({ status: 'success', data: { voucher: await vouchers.createVoucher(req.company!.id, input(req.body)) } });
};

export const updateVoucher = async (req: Request, res: Response) => {
    await vouchers.updateVoucher(req.company!.id, req.params.id, input(req.body));
    res.status(200).json({ status: 'success', message: 'Voucher updated successfully' });
};

export const deleteVoucher = async (req: Request, res: Response) => {
    await vouchers.deleteVoucher(req.company!.id, req.params.id);
    res.status(204).send();
};

export const getVouchers = async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const list = await vouchers.listVouchers(req.company!.id, { fromDate: q.fromDate, toDate: q.toDate, voucherTypeId: q.voucherTypeId });
    res.status(200).json({ status: 'success', data: { vouchers: list } });
};

export const getVoucherTypes = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { voucherTypes: await vouchers.listVoucherTypes(req.company!.id) } });
};

export const getNextVoucherNumber = async (req: Request, res: Response) => {
    const date = String(req.query.date || toDateString(new Date()));
    const number = await vouchers.nextVoucherNumber(req.company!.id, String(req.query.voucherTypeId || ''), date);
    res.status(200).json({ status: 'success', data: { number } });
};

export const getVoucherById = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: await vouchers.getVoucher(req.params.id) });
};
