import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { companyBasics } from '../services/companyService';
import { balanceSheet, profitAndLoss, trialBalance } from '../services/reportService';
import { readPeriod } from './reportController';
import { toDateString } from '../services/financialYear';

const INR_FMT = '#,##,##0.00';

const newSheet = async (companyId: string, title: string, subtitle: string) => {
    const company = await companyBasics(companyId);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'CloudLedger';
    const ws = wb.addWorksheet(title);
    ws.addRow([company?.name || '']).font = { bold: true, size: 14 };
    if (company?.gstin) ws.addRow([`GSTIN: ${company.gstin}`]);
    ws.addRow([title]).font = { bold: true, size: 12 };
    ws.addRow([subtitle]).font = { italic: true };
    ws.addRow([]);
    return { wb, ws };
};

const header = (ws: ExcelJS.Worksheet, cols: string[]) => {
    const row = ws.addRow(cols);
    row.font = { bold: true };
    row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
        c.border = { bottom: { style: 'thin' } };
    });
};

const send = async (res: Response, wb: ExcelJS.Workbook, filename: string) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
};

export const exportTrialBalanceExcel = async (req: Request, res: Response) => {
    const { from, to } = await readPeriod(req);
    const tb = await trialBalance(req.company!.id, from, to);
    const { wb, ws } = await newSheet(req.company!.id, 'Trial Balance', `${from} to ${to}`);
    header(ws, ['Ledger', 'Group', 'Opening', 'Dr/Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr']);
    for (const r of tb.report) {
        ws.addRow([
            r.name, r.group_name, r.opening_balance, r.opening_balance_type, r.total_debit, r.total_credit,
            r.closing_balance_type === 'Dr' ? r.closing_balance : null,
            r.closing_balance_type === 'Cr' ? r.closing_balance : null,
        ]);
    }
    const t = ws.addRow(['Total', '', '', '', '', '', tb.totals.debit, tb.totals.credit]);
    t.font = { bold: true };
    ws.columns.forEach((c, i) => {
        c.width = i < 2 ? 32 : 16;
        if (i >= 2 && i !== 3) c.numFmt = INR_FMT;
    });
    await send(res, wb, `trial-balance-${from}-to-${to}.xlsx`);
};

export const exportPnLExcel = async (req: Request, res: Response) => {
    const { from, to } = await readPeriod(req);
    const pl = await profitAndLoss(req.company!.id, from, to);
    const { wb, ws } = await newSheet(req.company!.id, 'Profit & Loss', `${from} to ${to}`);
    header(ws, ['Particulars', 'Group', 'Amount']);
    ws.addRow(['Income']).font = { bold: true };
    pl.income.forEach((l) => ws.addRow([l.ledger_name, l.group_name, l.balance]));
    ws.addRow(['Total Income', '', pl.totalIncome]).font = { bold: true };
    ws.addRow([]);
    ws.addRow(['Expenses']).font = { bold: true };
    pl.expenses.forEach((l) => ws.addRow([l.ledger_name, l.group_name, l.balance]));
    ws.addRow(['Total Expenses', '', pl.totalExpenses]).font = { bold: true };
    ws.addRow([]);
    ws.addRow(['Gross Profit', '', pl.grossProfit]).font = { bold: true };
    ws.addRow([`Net ${pl.netProfitType}`, '', Math.abs(pl.netProfit)]).font = { bold: true };
    ws.columns.forEach((c, i) => {
        c.width = i < 2 ? 32 : 18;
        if (i === 2) c.numFmt = INR_FMT;
    });
    await send(res, wb, `profit-and-loss-${from}-to-${to}.xlsx`);
};

export const exportBalanceSheetExcel = async (req: Request, res: Response) => {
    const asOf = String(req.query.asOfDate || toDateString(new Date())).slice(0, 10);
    const bs = await balanceSheet(req.company!.id, asOf);
    const { wb, ws } = await newSheet(req.company!.id, 'Balance Sheet', `As on ${asOf}`);
    header(ws, ['Liabilities', 'Group', 'Amount', '', 'Assets', 'Group', 'Amount']);
    const n = Math.max(bs.liabilities.length, bs.assets.length);
    for (let i = 0; i < n; i++) {
        const l = bs.liabilities[i];
        const a = bs.assets[i];
        ws.addRow([l?.ledger_name, l?.group_name, l?.balance, '', a?.ledger_name, a?.group_name, a?.balance]);
    }
    ws.addRow(['Total', '', bs.totalLiabilities, '', 'Total', '', bs.totalAssets]).font = { bold: true };
    ws.columns.forEach((c, i) => {
        c.width = [28, 22, 16, 3, 28, 22, 16][i];
        if (i === 2 || i === 6) c.numFmt = INR_FMT;
    });
    await send(res, wb, `balance-sheet-${asOf}.xlsx`);
};
