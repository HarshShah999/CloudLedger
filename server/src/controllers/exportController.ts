import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

// Export Trial Balance to Excel
export const exportTrialBalanceExcel = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, startDate, endDate } = req.query;

    if (!companyId) {
        return next(new AppError('Company ID is required', 400));
    }

    try {
        // Fetch trial balance data
        const result = await query(
            `SELECT 
         l.id, l.name, lg.name as group_name, lg.type as group_type,
         l.opening_balance, l.opening_balance_type,
         COALESCE(SUM(CASE WHEN ve.type = 'Dr' THEN ve.amount ELSE 0 END), 0) as total_debit,
         COALESCE(SUM(CASE WHEN ve.type = 'Cr' THEN ve.amount ELSE 0 END), 0) as total_credit
       FROM ledgers l
       LEFT JOIN ledger_groups lg ON l.group_id = lg.id
       LEFT JOIN voucher_entries ve ON l.id = ve.ledger_id
       LEFT JOIN vouchers v ON ve.voucher_id = v.id
       WHERE l.company_id = $1
       AND (v.date IS NULL OR (v.date >= $2 AND v.date <= $3))
       GROUP BY l.id, l.name, lg.name, lg.type, l.opening_balance, l.opening_balance_type
       ORDER BY lg.type, lg.name, l.name`,
            [companyId, startDate || '1900-01-01', endDate || '2100-12-31']
        );

        // Create workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Trial Balance');

        // Add headers
        worksheet.columns = [
            { header: 'Ledger Name', key: 'name', width: 30 },
            { header: 'Group', key: 'group_name', width: 20 },
            { header: 'Opening Balance', key: 'opening_balance', width: 15 },
            { header: 'Debit', key: 'debit', width: 15 },
            { header: 'Credit', key: 'credit', width: 15 },
            { header: 'Closing Balance', key: 'closing_balance', width: 15 }
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // Add data
        result.rows.forEach(row => {
            const openDr = row.opening_balance_type === 'Dr' ? Number(row.opening_balance) : 0;
            const openCr = row.opening_balance_type === 'Cr' ? Number(row.opening_balance) : 0;
            const currentDr = Number(row.total_debit);
            const currentCr = Number(row.total_credit);
            const totalDr = openDr + currentDr;
            const totalCr = openCr + currentCr;
            const closingBalance = Math.abs(totalDr - totalCr);
            const closingType = totalDr > totalCr ? 'Dr' : 'Cr';

            worksheet.addRow({
                name: row.name,
                group_name: row.group_name,
                opening_balance: `${row.opening_balance} ${row.opening_balance_type}`,
                debit: totalDr.toFixed(2),
                credit: totalCr.toFixed(2),
                closing_balance: `${closingBalance.toFixed(2)} ${closingType}`
            });
        });

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=trial-balance.xlsx');

        // Write to response
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

// Export P&L to Excel
export const exportPnLExcel = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, startDate, endDate } = req.query;

    if (!companyId || !startDate || !endDate) {
        return next(new AppError('Company ID, start date, and end date are required', 400));
    }

    try {
        const result = await query(
            `SELECT 
                lg.name as group_name,
                lg.type as group_type,
                l.name as ledger_name,
                COALESCE(SUM(CASE WHEN ve.type = 'Dr' THEN ve.amount ELSE 0 END), 0) as total_debit,
                COALESCE(SUM(CASE WHEN ve.type = 'Cr' THEN ve.amount ELSE 0 END), 0) as total_credit
            FROM ledgers l
            LEFT JOIN ledger_groups lg ON l.group_id = lg.id
            LEFT JOIN voucher_entries ve ON l.id = ve.ledger_id
            LEFT JOIN vouchers v ON ve.voucher_id = v.id
            WHERE l.company_id = $1
            AND lg.type IN ('Income', 'Expense')
            AND (v.date IS NULL OR (v.date >= $2 AND v.date <= $3))
            GROUP BY lg.name, lg.type, l.name
            ORDER BY lg.type, l.name`,
            [companyId, startDate, endDate]
        );

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Profit & Loss');

        worksheet.columns = [
            { header: 'Particulars', key: 'particulars', width: 40 },
            { header: 'Amount', key: 'amount', width: 20 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        let totalIncome = 0;
        let totalExpenses = 0;

        // Add Income section
        worksheet.addRow({ particulars: 'INCOME', amount: '' }).font = { bold: true };
        result.rows.filter((r: any) => r.group_type === 'Income').forEach((row: any) => {
            const balance = parseFloat(row.total_credit) - parseFloat(row.total_debit);
            totalIncome += balance;
            worksheet.addRow({
                particulars: `  ${row.ledger_name}`,
                amount: balance.toFixed(2)
            });
        });
        worksheet.addRow({ particulars: 'Total Income', amount: totalIncome.toFixed(2) }).font = { bold: true };

        worksheet.addRow({ particulars: '', amount: '' });

        // Add Expenses section
        worksheet.addRow({ particulars: 'EXPENSES', amount: '' }).font = { bold: true };
        result.rows.filter((r: any) => r.group_type === 'Expense').forEach((row: any) => {
            const balance = parseFloat(row.total_debit) - parseFloat(row.total_credit);
            totalExpenses += balance;
            worksheet.addRow({
                particulars: `  ${row.ledger_name}`,
                amount: balance.toFixed(2)
            });
        });
        worksheet.addRow({ particulars: 'Total Expenses', amount: totalExpenses.toFixed(2) }).font = { bold: true };

        worksheet.addRow({ particulars: '', amount: '' });

        const netProfit = totalIncome - totalExpenses;
        worksheet.addRow({
            particulars: netProfit >= 0 ? 'Net Profit' : 'Net Loss',
            amount: Math.abs(netProfit).toFixed(2)
        }).font = { bold: true, color: { argb: netProfit >= 0 ? 'FF008000' : 'FFFF0000' } };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=profit-loss.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

// Export Balance Sheet to Excel
export const exportBalanceSheetExcel = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, asOfDate } = req.query;

    if (!companyId || !asOfDate) {
        return next(new AppError('Company ID and as-of date are required', 400));
    }

    try {
        const result = await query(
            `SELECT 
                lg.name as group_name,
                lg.type as group_type,
                l.name as ledger_name,
                l.opening_balance,
                l.opening_balance_type,
                COALESCE(SUM(CASE WHEN ve.type = 'Dr' THEN ve.amount ELSE 0 END), 0) as total_debit,
                COALESCE(SUM(CASE WHEN ve.type = 'Cr' THEN ve.amount ELSE 0 END), 0) as total_credit
            FROM ledgers l
            LEFT JOIN ledger_groups lg ON l.group_id = lg.id
            LEFT JOIN voucher_entries ve ON l.id = ve.ledger_id
            LEFT JOIN vouchers v ON ve.voucher_id = v.id
            WHERE l.company_id = $1
            AND lg.type IN ('Asset', 'Liability')
            AND (v.date IS NULL OR v.date <= $2)
            GROUP BY lg.name, lg.type, l.name, l.opening_balance, l.opening_balance_type
            ORDER BY lg.type, l.name`,
            [companyId, asOfDate]
        );

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Balance Sheet');

        worksheet.columns = [
            { header: 'Liabilities', key: 'liabilities', width: 40 },
            { header: 'Amount', key: 'lib_amount', width: 20 },
            { header: 'Assets', key: 'assets', width: 40 },
            { header: 'Amount', key: 'asset_amount', width: 20 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        const liabilities = result.rows.filter((r: any) => r.group_type === 'Liability');
        const assets = result.rows.filter((r: any) => r.group_type === 'Asset');

        let totalLiabilities = 0;
        let totalAssets = 0;

        const maxRows = Math.max(liabilities.length, assets.length);

        for (let i = 0; i < maxRows; i++) {
            const lib = liabilities[i];
            const asset = assets[i];

            let libBalance = 0;
            let assetBalance = 0;

            if (lib) {
                const openingBalance = parseFloat(lib.opening_balance) || 0;
                const debit = parseFloat(lib.total_debit);
                const credit = parseFloat(lib.total_credit);
                libBalance = openingBalance + (credit - debit);
                totalLiabilities += libBalance;
            }

            if (asset) {
                const openingBalance = parseFloat(asset.opening_balance) || 0;
                const debit = parseFloat(asset.total_debit);
                const credit = parseFloat(asset.total_credit);
                assetBalance = openingBalance + (debit - credit);
                totalAssets += assetBalance;
            }

            worksheet.addRow({
                liabilities: lib ? lib.ledger_name : '',
                lib_amount: lib ? libBalance.toFixed(2) : '',
                assets: asset ? asset.ledger_name : '',
                asset_amount: asset ? assetBalance.toFixed(2) : ''
            });
        }

        worksheet.addRow({
            liabilities: 'Total Liabilities',
            lib_amount: totalLiabilities.toFixed(2),
            assets: 'Total Assets',
            asset_amount: totalAssets.toFixed(2)
        }).font = { bold: true };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=balance-sheet.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};
