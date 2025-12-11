import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { checkPeriodLocked } from './financialYearController';

export const createVoucher = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId, voucherTypeId, voucherNumber, date, narration, entries } = req.body;

    if (!entries || entries.length === 0) {
        return next(new AppError('Voucher must have entries', 400));
    }

    // Check if period is locked
    const isLocked = await checkPeriodLocked(companyId, date);
    if (isLocked) {
        return next(new AppError('Cannot create voucher in a closed financial period', 400));
    }

    // Calculate totals
    let totalDebit = 0;
    let totalCredit = 0;

    entries.forEach((entry: any) => {
        if (entry.type === 'Dr') totalDebit += Number(entry.amount);
        if (entry.type === 'Cr') totalCredit += Number(entry.amount);
    });

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return next(new AppError(`Voucher is not balanced. Debit: ${totalDebit}, Credit: ${totalCredit}`, 400));
    }

    try {
        await query('BEGIN');

        // 1. Create Voucher Header
        const voucherResult = await query(
            'INSERT INTO vouchers (company_id, voucher_type_id, voucher_number, date, narration, total_amount) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [companyId, voucherTypeId, voucherNumber, date, narration, totalDebit]
        );
        const voucher = voucherResult.rows[0];

        // 2. Create Voucher Entries
        for (const entry of entries) {
            await query(
                'INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)',
                [voucher.id, entry.ledgerId, entry.amount, entry.type]
            );
        }

        await query('COMMIT');

        res.status(201).json({
            status: 'success',
            data: {
                voucher,
            },
        });
    } catch (error) {
        await query('ROLLBACK');
        next(error);
    }
};

export const getVouchers = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId } = req.query;

    if (!companyId) {
        return next(new AppError('Company ID is required', 400));
    }

    try {
        const result = await query(
            `SELECT v.*, vt.name as voucher_type_name 
       FROM vouchers v 
       LEFT JOIN voucher_types vt ON v.voucher_type_id = vt.id 
       WHERE v.company_id = $1 
       ORDER BY v.date DESC, v.created_at DESC`,
            [companyId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                vouchers: result.rows,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getVoucherTypes = async (req: Request, res: Response, next: NextFunction) => {
    const { companyId } = req.query;

    if (!companyId) {
        return next(new AppError('Company ID is required', 400));
    }

    try {
        const result = await query(
            'SELECT * FROM voucher_types WHERE company_id = $1',
            [companyId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                voucherTypes: result.rows,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Get voucher by ID with entries
export const getVoucherById = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        const voucherResult = await query(
            `SELECT v.*, vt.name as voucher_type_name 
             FROM vouchers v 
             LEFT JOIN voucher_types vt ON v.voucher_type_id = vt.id 
             WHERE v.id = $1`,
            [id]
        );

        if (voucherResult.rows.length === 0) {
            return next(new AppError('Voucher not found', 404));
        }

        const entriesResult = await query(
            `SELECT ve.*, l.name as ledger_name 
             FROM voucher_entries ve 
             LEFT JOIN ledgers l ON ve.ledger_id = l.id 
             WHERE ve.voucher_id = $1`,
            [id]
        );

        res.status(200).json({
            status: 'success',
            data: {
                voucher: voucherResult.rows[0],
                entries: entriesResult.rows,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Update voucher
export const updateVoucher = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { voucherTypeId, voucherNumber, date, narration, entries } = req.body;

    if (!entries || entries.length === 0) {
        return next(new AppError('Voucher must have entries', 400));
    }

    try {
        // Get existing voucher
        const existingVoucher = await query('SELECT * FROM vouchers WHERE id = $1', [id]);
        if (existingVoucher.rows.length === 0) {
            return next(new AppError('Voucher not found', 404));
        }

        const voucher = existingVoucher.rows[0];

        // Check if original period is locked
        const isOriginalLocked = await checkPeriodLocked(voucher.company_id, voucher.date);
        if (isOriginalLocked) {
            return next(new AppError('Cannot update voucher in a closed financial period', 400));
        }

        // Check if new period is locked (if date changed)
        if (date !== voucher.date) {
            const isNewLocked = await checkPeriodLocked(voucher.company_id, date);
            if (isNewLocked) {
                return next(new AppError('Cannot move voucher to a closed financial period', 400));
            }
        }

        // Calculate totals
        let totalDebit = 0;
        let totalCredit = 0;

        entries.forEach((entry: any) => {
            if (entry.type === 'Dr') totalDebit += Number(entry.amount);
            if (entry.type === 'Cr') totalCredit += Number(entry.amount);
        });

        if (Math.abs(totalDebit - totalCredit) > 0.01) {
            return next(new AppError(`Voucher is not balanced. Debit: ${totalDebit}, Credit: ${totalCredit}`, 400));
        }

        await query('BEGIN');

        // Update voucher header
        await query(
            'UPDATE vouchers SET voucher_type_id = $1, voucher_number = $2, date = $3, narration = $4, total_amount = $5 WHERE id = $6',
            [voucherTypeId, voucherNumber, date, narration, totalDebit, id]
        );

        // Delete old entries
        await query('DELETE FROM voucher_entries WHERE voucher_id = $1', [id]);

        // Insert new entries
        for (const entry of entries) {
            await query(
                'INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, $3, $4)',
                [id, entry.ledgerId, entry.amount, entry.type]
            );
        }

        await query('COMMIT');

        res.status(200).json({
            status: 'success',
            message: 'Voucher updated successfully',
        });
    } catch (error) {
        await query('ROLLBACK');
        next(error);
    }
};

// Delete voucher
export const deleteVoucher = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        // Get voucher
        const voucherResult = await query('SELECT * FROM vouchers WHERE id = $1', [id]);
        if (voucherResult.rows.length === 0) {
            return next(new AppError('Voucher not found', 404));
        }

        const voucher = voucherResult.rows[0];

        // Check if period is locked
        const isLocked = await checkPeriodLocked(voucher.company_id, voucher.date);
        if (isLocked) {
            return next(new AppError('Cannot delete voucher in a closed financial period', 400));
        }

        await query('BEGIN');

        // Delete entries first (foreign key constraint)
        await query('DELETE FROM voucher_entries WHERE voucher_id = $1', [id]);

        // Delete voucher
        await query('DELETE FROM vouchers WHERE id = $1', [id]);

        await query('COMMIT');

        res.status(204).json({
            status: 'success',
            data: null,
        });
    } catch (error) {
        await query('ROLLBACK');
        next(error);
    }
};
