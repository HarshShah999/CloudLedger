import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

export const createCompany = async (req: Request, res: Response, next: NextFunction) => {
    const { name, address, email, phone, currency, financialYear, gstin } = req.body;
    const userId = req.user?.id;

    try {
        await query('BEGIN');

        // 1. Create Company
        const companyResult = await query(
            'INSERT INTO companies (name, address, email, phone, currency, gstin, state) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [name, address, email, phone, currency || 'INR', gstin, req.body.state]
        );
        const company = companyResult.rows[0];

        // 2. Link User to Company as Admin
        await query(
            'INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)',
            [company.id, userId, 'admin']
        );

        // 3. Create Financial Year
        if (financialYear) {
            await query(
                'INSERT INTO financial_years (company_id, name, start_date, end_date, is_active) VALUES ($1, $2, $3, $4, $5)',
                [company.id, financialYear.name, financialYear.startDate, financialYear.endDate, true]
            );
        }

        // 4. Create Default Ledger Groups
        const groups = [
            { name: 'Assets', type: 'Asset' },
            { name: 'Liabilities', type: 'Liability' },
            { name: 'Income', type: 'Income' },
            { name: 'Expenses', type: 'Expense' },
            { name: 'Bank Accounts', type: 'Asset' }
        ];

        for (const group of groups) {
            await query(
                'INSERT INTO ledger_groups (company_id, name, type) VALUES ($1, $2, $3)',
                [company.id, group.name, group.type]
            );
        }

        // 5. Create Voucher Types
        const voucherTypes = ['Sales', 'Purchase', 'Payment', 'Receipt', 'Journal'];
        for (const vType of voucherTypes) {
            await query(
                'INSERT INTO voucher_types (company_id, name) VALUES ($1, $2)',
                [company.id, vType]
            );
        }

        await query('COMMIT');

        res.status(201).json({
            status: 'success',
            data: {
                company,
            },
        });
    } catch (error) {
        await query('ROLLBACK');
        next(error);
    }
};

export const getCompanies = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;

    try {
        const result = await query(
            `SELECT c.*, cu.role 
       FROM companies c 
       JOIN company_users cu ON c.id = cu.company_id 
       WHERE cu.user_id = $1`,
            [userId]
        );

        res.status(200).json({
            status: 'success',
            results: result.rows.length,
            data: {
                companies: result.rows,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getCompany = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = req.user?.id;

    try {
        // Check access
        const accessCheck = await query(
            'SELECT * FROM company_users WHERE company_id = $1 AND user_id = $2',
            [id, userId]
        );

        if (accessCheck.rows.length === 0) {
            return next(new AppError('You do not have access to this company', 403));
        }

        const companyResult = await query('SELECT * FROM companies WHERE id = $1', [id]);

        if (companyResult.rows.length === 0) {
            return next(new AppError('Company not found', 404));
        }

        res.status(200).json({
            status: 'success',
            data: {
                company: companyResult.rows[0],
            },
        });
    } catch (error) {
        next(error);
    }
};
