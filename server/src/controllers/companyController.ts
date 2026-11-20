import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { seedCompany } from '../services/companySetup';
import { indianFinancialYear, toDateString } from '../services/financialYear';

export const createCompany = async (req: Request, res: Response) => {
    const { name, address, email, phone, currency, financialYear, gstin, state } = req.body;
    const userId = req.user!.id;

    const company = await withTransaction(async (db) => {
        const company = (
            await db.query(
                `INSERT INTO companies (name, address, email, phone, currency, gstin, state)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [name, address || null, email || null, phone || null, currency || 'INR', gstin || null, state]
            )
        ).rows[0];

        await db.query('INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)', [
            company.id,
            userId,
            'admin',
        ]);

        const fy = financialYear?.startDate
            ? {
                  name: financialYear.name,
                  startDate: toDateString(financialYear.startDate),
                  endDate: toDateString(financialYear.endDate),
              }
            : indianFinancialYear(toDateString(new Date()));
        if (fy.endDate <= fy.startDate) throw new AppError('Financial year end must be after its start', 400);
        await db.query(
            `INSERT INTO financial_years (company_id, name, start_date, end_date, is_active, is_closed)
             VALUES ($1, $2, $3, $4, true, false)`,
            [company.id, fy.name, fy.startDate, fy.endDate]
        );

        await seedCompany(db, company.id);
        return company;
    });

    res.status(201).json({ status: 'success', data: { company: { ...company, role: 'admin' } } });
};

export const getCompanies = async (req: Request, res: Response) => {
    const result = await query(
        `SELECT c.*, cu.role FROM companies c
         JOIN company_users cu ON c.id = cu.company_id
         WHERE cu.user_id = $1 ORDER BY c.name`,
        [req.user!.id]
    );
    res.status(200).json({ status: 'success', results: result.rows.length, data: { companies: result.rows } });
};

export const getCompany = async (req: Request, res: Response) => {
    const result = await query('SELECT * FROM companies WHERE id = $1', [req.company!.id]);
    if (!result.rows.length) throw new AppError('Company not found', 404);
    res.status(200).json({ status: 'success', data: { company: { ...result.rows[0], role: req.company!.role } } });
};

export const updateCompany = async (req: Request, res: Response) => {
    const fields = [
        'name', 'address', 'email', 'phone', 'gstin', 'state', 'round_off_invoices', 'pan', 'website', 'upi_id',
        'bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'bank_branch', 'invoice_terms',
        'share_message_template', 'share_link_days',
    ] as const;
    const map: Record<string, string> = {
        roundOffInvoices: 'round_off_invoices', upiId: 'upi_id', bankName: 'bank_name', bankAccountName: 'bank_account_name',
        bankAccountNumber: 'bank_account_number', bankIfsc: 'bank_ifsc', bankBranch: 'bank_branch',
        invoiceTerms: 'invoice_terms', shareMessageTemplate: 'share_message_template', shareLinkDays: 'share_link_days',
    };
    const sets: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(req.body)) {
        const column = map[key] ?? key;
        if (!(fields as readonly string[]).includes(column)) continue;
        values.push(value === '' ? null : value);
        sets.push(`${column} = $${values.length}`);
    }
    if (!sets.length) throw new AppError('Nothing to update', 400);
    values.push(req.company!.id);
    const result = await query(`UPDATE companies SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    res.status(200).json({ status: 'success', data: { company: result.rows[0] } });
};
