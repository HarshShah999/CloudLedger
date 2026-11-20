/** Companies: creation (with chart of accounts and first financial year), profile and settings. */
import { query, withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { seedCompany } from './companySetup';
import { indianFinancialYear, toDateString } from './financialYear';
import { encryptSecret } from '../utils/secrets';
import { listAssetKinds } from './assetService';

/** Creates a company, makes the user its admin, opens the financial year and seeds the chart of accounts. */
export const createCompany = async (userId: string, input: any) => {
    const { name, address, email, phone, currency, financialYear, gstin, state } = input;
    return withTransaction(async (db) => {
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

};

/** Never send stored secrets to the browser; only whether they are set. */
export const withoutSecrets = (row: any) => {
    const { whatsapp_token_enc, ...rest } = row;
    return { ...rest, has_whatsapp_token: !!whatsapp_token_enc };
};

export const listCompaniesForUser = async (userId: string) =>
    (
        await query(
            `SELECT c.*, cu.role FROM companies c
             JOIN company_users cu ON c.id = cu.company_id
             WHERE cu.user_id = $1 ORDER BY c.name`,
            [userId]
        )
    ).rows.map(withoutSecrets);

export const getCompanyProfile = async (companyId: string, role: string) => {
    const result = await query('SELECT * FROM companies WHERE id = $1', [companyId]);
    if (!result.rows.length) throw new AppError('Company not found', 404);
    const assets = await listAssetKinds(companyId);
    return { ...withoutSecrets(result.rows[0]), role, has_logo: assets.includes('logo'), has_signature: assets.includes('signature') };
};

/** Updates the settings that were sent; the WhatsApp token is write-only and stored encrypted. */
export const updateCompany = async (companyId: string, body: Record<string, any>) => {
    const fields = [
        'name', 'address', 'email', 'phone', 'gstin', 'state', 'round_off_invoices', 'pan', 'website', 'upi_id',
        'bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'bank_branch', 'invoice_terms',
        'share_message_template', 'share_link_days', 'brand_color', 'print_copy_labels', 'city', 'pincode',
        'einvoice_enabled', 'reminders_enabled', 'reminder_days', 'reminder_channels', 'whatsapp_phone_number_id',
        'whatsapp_template', 'whatsapp_template_lang',
    ] as const;
    const map: Record<string, string> = {
        roundOffInvoices: 'round_off_invoices', upiId: 'upi_id', bankName: 'bank_name', bankAccountName: 'bank_account_name',
        bankAccountNumber: 'bank_account_number', bankIfsc: 'bank_ifsc', bankBranch: 'bank_branch',
        invoiceTerms: 'invoice_terms', shareMessageTemplate: 'share_message_template', shareLinkDays: 'share_link_days',
        brandColor: 'brand_color', printCopyLabels: 'print_copy_labels', einvoiceEnabled: 'einvoice_enabled',
        remindersEnabled: 'reminders_enabled', reminderDays: 'reminder_days', reminderChannels: 'reminder_channels',
        whatsappPhoneNumberId: 'whatsapp_phone_number_id', whatsappTemplate: 'whatsapp_template',
        whatsappTemplateLang: 'whatsapp_template_lang',
    };
    const sets: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(body)) {
        const column = map[key] ?? key;
        if (!(fields as readonly string[]).includes(column)) continue;
        values.push(value === '' ? null : value);
        sets.push(`${column} = $${values.length}`);
    }
    // The WhatsApp token is write-only and stored encrypted
    if ('whatsappToken' in body) {
        values.push(body.whatsappToken ? encryptSecret(body.whatsappToken) : null);
        sets.push(`whatsapp_token_enc = $${values.length}`);
    }
    if (!sets.length) throw new AppError('Nothing to update', 400);
    values.push(companyId);
    const result = await query(`UPDATE companies SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    return withoutSecrets(result.rows[0]);
};

/** Name and GSTIN, for report headers. */
export const companyBasics = async (companyId: string) =>
    (await query('SELECT name, gstin FROM companies WHERE id = $1', [companyId])).rows[0] as { name: string; gstin: string | null } | undefined;
