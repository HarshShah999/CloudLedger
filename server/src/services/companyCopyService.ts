/**
 * Copying a company between installations: export one company to a JSON file
 * and import such a file as a new company (masters and vouchers).
 */
import fs from 'fs/promises';
import path from 'path';
import { query, withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { seedCompany } from './companySetup';

export const COMPANY_BACKUP_DIR = path.join(process.env.BACKUP_DIR || './backups', 'companies');

/** Writes the company's data to a JSON file and logs it; the user must be a member. */
export const exportCompanyData = async (companyId: string, userId: string) => {
    // Check if user has access to this company
    const accessCheck = await query(
        'SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2',
        [companyId, userId]
    );

    if (accessCheck.rows.length === 0) {
        throw new AppError('Access denied to this company', 403);
    }

    console.log(`Exporting company ${companyId}...`);

    // Get company details
    const companyRes = await query('SELECT * FROM companies WHERE id = $1', [companyId]);
    if (companyRes.rows.length === 0) {
        throw new AppError('Company not found', 404);
    }
    const company = companyRes.rows[0];

    // Get financial years
    const fyRes = await query(
        'SELECT * FROM financial_years WHERE company_id = $1 ORDER BY start_date',
        [companyId]
    );

    // Get ledger groups
    const groupsRes = await query(
        'SELECT * FROM ledger_groups WHERE company_id = $1 ORDER BY created_at',
        [companyId]
    );

    // Get ledgers
    const ledgersRes = await query(
        'SELECT * FROM ledgers WHERE company_id = $1 ORDER BY created_at',
        [companyId]
    );

    // Get voucher types
    const voucherTypesRes = await query(
        'SELECT * FROM voucher_types WHERE company_id = $1',
        [companyId]
    );

    // Get vouchers with entries
    const vouchersRes = await query(
        `SELECT v.*, 
                json_agg(
                    json_build_object(
                        'id', ve.id,
                        'ledger_id', ve.ledger_id,
                        'amount', ve.amount,
                        'type', ve.type
                    )
                ) as entries
         FROM vouchers v
         LEFT JOIN voucher_entries ve ON v.id = ve.voucher_id
         WHERE v.company_id = $1
         GROUP BY v.id
         ORDER BY v.date`,
        [companyId]
    );

    // Get units
    const unitsRes = await query(
        'SELECT * FROM units WHERE company_id = $1',
        [companyId]
    );

    // Get items
    const itemsRes = await query(
        'SELECT * FROM items WHERE company_id = $1',
        [companyId]
    );

    // Get invoices with items
    const invoicesRes = await query(
        `SELECT i.*,
                json_agg(
                    json_build_object(
                        'id', ii.id,
                        'item_id', ii.item_id,
                        'description', ii.description,
                        'quantity', ii.quantity,
                        'rate', ii.rate,
                        'amount', ii.amount,
                        'tax_rate', ii.tax_rate,
                        'tax_amount', ii.tax_amount,
                        'cgst_rate', ii.cgst_rate,
                        'cgst_amount', ii.cgst_amount,
                        'sgst_rate', ii.sgst_rate,
                        'sgst_amount', ii.sgst_amount,
                        'igst_rate', ii.igst_rate,
                        'igst_amount', ii.igst_amount,
                        'discount_percent', ii.discount_percent,
                        'discount_amount', ii.discount_amount,
                        'taxable_amount', ii.taxable_amount,
                        'total_amount', ii.total_amount
                    )
                ) as items
         FROM invoices i
         LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
         WHERE i.company_id = $1
         GROUP BY i.id
         ORDER BY i.date`,
        [companyId]
    );

    // Get recurring invoices
    const recurringRes = await query(
        `SELECT ri.*,
                json_agg(
                    json_build_object(
                        'id', rii.id,
                        'item_id', rii.item_id,
                        'description', rii.description,
                        'quantity', rii.quantity,
                        'rate', rii.rate,
                        'discount_percent', rii.discount_percent
                    )
                ) as items
         FROM recurring_invoices ri
         LEFT JOIN recurring_invoice_items rii ON ri.id = rii.recurring_invoice_id
         WHERE ri.company_id = $1
         GROUP BY ri.id`,
        [companyId]
    );

    // Build export data
    const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        company: company,
        financialYears: fyRes.rows,
        ledgerGroups: groupsRes.rows,
        ledgers: ledgersRes.rows,
        voucherTypes: voucherTypesRes.rows,
        vouchers: vouchersRes.rows,
        units: unitsRes.rows,
        items: itemsRes.rows,
        invoices: invoicesRes.rows,
        recurringInvoices: recurringRes.rows
    };

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
    const filename = `${company.name.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.json`;
    const filepath = path.join(COMPANY_BACKUP_DIR, filename);

    // Ensure directory exists
    await fs.mkdir(COMPANY_BACKUP_DIR, { recursive: true });

    // Write to file
    await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));

    // Get file size
    const stats = await fs.stat(filepath);

    // Log export
    await query(
        `INSERT INTO backup_logs (type, filename, file_size, status, created_by, company_id, storage_location)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['COMPANY', filename, stats.size, 'SUCCESS', userId, companyId, 'local']
    );

    console.log(`✅ Company exported: ${filename}`);

    return { filename, size: stats.size, sizeFormatted: `${(stats.size / 1024).toFixed(2)} KB` };
};

/** Imports an exported company as a new company owned by the user. */
export const importCompanyData = async (userId: string, companyData: any) => {
    // Validate data structure
    if (!companyData || !companyData.version || !companyData.company) {
        throw new AppError('Invalid company data format', 400);
    }

    console.log('Importing company...');

    const imported = await withTransaction(async (client) => {
        // Shadow the pool query so every statement below runs inside this transaction
        const query = (text: string, params?: any[]) => client.query(text, params);
        // Create company
        const companyRes = await query(
            `INSERT INTO companies (name, address, email, phone, currency, gstin, state)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
                companyData.company.name + ' (Imported)',
                companyData.company.address,
                companyData.company.email,
                companyData.company.phone,
                companyData.company.currency || 'INR',
                companyData.company.gstin,
                companyData.company.state
            ]
        );
        const newCompanyId = companyRes.rows[0].id;

        // Add user to company
        await query(
            'INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)',
            [newCompanyId, userId, 'admin']
        );

        // Map old IDs to new IDs
        const idMap: any = {
            financialYears: {},
            ledgerGroups: {},
            ledgers: {},
            voucherTypes: {},
            vouchers: {},
            units: {},
            items: {}
        };

        // Import financial years
        for (const fy of companyData.financialYears || []) {
            const res = await query(
                `INSERT INTO financial_years (company_id, name, start_date, end_date, is_active)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id`,
                [newCompanyId, fy.name, fy.start_date, fy.end_date, false]
            );
            idMap.financialYears[fy.id] = res.rows[0].id;
        }

        // Import ledger groups (handle parent relationships)
        const groupsToImport = [...(companyData.ledgerGroups || [])];
        while (groupsToImport.length > 0) {
            const group = groupsToImport.shift();
            if (!group) continue;

            // Check if parent exists in map (or is null)
            if (group.parent_id && !idMap.ledgerGroups[group.parent_id]) {
                groupsToImport.push(group); // Try again later
                continue;
            }

            const res = await query(
                `INSERT INTO ledger_groups (company_id, name, parent_id, type)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                [
                    newCompanyId,
                    group.name,
                    group.parent_id ? idMap.ledgerGroups[group.parent_id] : null,
                    group.type
                ]
            );
            idMap.ledgerGroups[group.id] = res.rows[0].id;
        }

        // Import ledgers
        for (const ledger of companyData.ledgers || []) {
            const res = await query(
                `INSERT INTO ledgers (company_id, group_id, name, opening_balance, opening_balance_type, current_balance, gstin, state, email, phone)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING id`,
                [
                    newCompanyId,
                    ledger.group_id ? idMap.ledgerGroups[ledger.group_id] : null,
                    ledger.name,
                    ledger.opening_balance || 0,
                    ledger.opening_balance_type || 'Dr',
                    ledger.current_balance || 0,
                    ledger.gstin,
                    ledger.state,
                    ledger.email,
                    ledger.phone
                ]
            );
            idMap.ledgers[ledger.id] = res.rows[0].id;
        }

        // Import voucher types
        for (const vt of companyData.voucherTypes || []) {
            const res = await query(
                `INSERT INTO voucher_types (company_id, name)
                 VALUES ($1, $2)
                 RETURNING id`,
                [newCompanyId, vt.name]
            );
            idMap.voucherTypes[vt.id] = res.rows[0].id;
        }

        // Import units
        for (const unit of companyData.units || []) {
            const res = await query(
                `INSERT INTO units (company_id, name, symbol)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [newCompanyId, unit.name, unit.symbol]
            );
            idMap.units[unit.id] = res.rows[0].id;
        }

        // Import items
        for (const item of companyData.items || []) {
            const res = await query(
                `INSERT INTO items (company_id, name, hsn_code, unit_id, description, tax_rate, sales_rate, purchase_rate, opening_quantity, current_quantity, opening_rate)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
                 RETURNING id`,
                [
                    newCompanyId,
                    item.name,
                    item.hsn_code,
                    item.unit_id ? idMap.units[item.unit_id] : null,
                    item.description,
                    item.tax_rate || 0,
                    item.sales_rate || 0,
                    item.purchase_rate || 0,
                    item.opening_quantity || 0,
                    // Current stock = opening + stock movements (kept by the database)
                    item.opening_rate ?? item.purchase_rate ?? 0,
                ]
            );
            idMap.items[item.id] = res.rows[0].id;
        }

        // Import vouchers with entries
        for (const voucher of companyData.vouchers || []) {
            const vRes = await query(
                `INSERT INTO vouchers (company_id, financial_year_id, voucher_type_id, voucher_number, date, narration, total_amount)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id`,
                [
                    newCompanyId,
                    voucher.financial_year_id ? idMap.financialYears[voucher.financial_year_id] : null,
                    voucher.voucher_type_id ? idMap.voucherTypes[voucher.voucher_type_id] : null,
                    voucher.voucher_number,
                    voucher.date,
                    voucher.narration,
                    voucher.total_amount
                ]
            );
            const newVoucherId = vRes.rows[0].id;
            idMap.vouchers[voucher.id] = newVoucherId;

            // Import voucher entries
            if (voucher.entries && Array.isArray(voucher.entries)) {
                for (const entry of voucher.entries) {
                    if (entry.ledger_id) {
                        await query(
                            `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type)
                             VALUES ($1, $2, $3, $4)`,
                            [
                                newVoucherId,
                                idMap.ledgers[entry.ledger_id],
                                entry.amount,
                                entry.type
                            ]
                        );
                    }
                }
            }
        }

        await seedCompany(client, newCompanyId);
        return { companyId: newCompanyId, companyName: companyData.company.name + ' (Imported)' };
    });

    return imported;
};

/** Company exports of every company the user administers. */
export const listCompanyExports = async (userId: string) => {
    // Get all company exports
    const logsRes = await query(
        `SELECT bl.*, c.name as company_name, u.name as created_by_name
         FROM backup_logs bl
         LEFT JOIN companies c ON bl.company_id = c.id
         LEFT JOIN users u ON bl.created_by = u.id
         WHERE bl.type = 'COMPANY'
           AND bl.company_id IN (SELECT company_id FROM company_users WHERE user_id = $1 AND role = 'admin')
         ORDER BY bl.created_at DESC
         LIMIT 50`,
        [userId]
    );

    return logsRes.rows;
};

/** Path of an export file, if the user administers its company. */
export const companyExportPath = async (userId: string, rawFilename: string) => {
    const filename = path.basename(rawFilename);
    const log = await query(
        `SELECT bl.company_id FROM backup_logs bl
         JOIN company_users cu ON cu.company_id = bl.company_id AND cu.user_id = $2 AND cu.role = 'admin'
         WHERE bl.type = 'COMPANY' AND bl.filename = $1`,
        [filename, userId]
    );
    if (!log.rows.length) throw new AppError('Export not found', 404);
    return { filepath: path.join(COMPANY_BACKUP_DIR, filename), filename };
};
