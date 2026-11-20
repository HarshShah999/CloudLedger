/** Reading invoices: lists with filters, one document with lines and payments, next number. */
import { query, withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { resolveFinancialYear, toDateString } from './financialYear';
import { peekNextNumber } from './numberSeries';

export interface InvoiceFilters { type?: string; paymentStatus?: string; fromDate?: string; toDate?: string; partyLedgerId?: string }

export const listInvoices = async (companyId: string, f: InvoiceFilters) => {
    const { type, paymentStatus, fromDate, toDate, partyLedgerId } = f;
    const params: any[] = [companyId];
    let sql = `SELECT i.*, l.name AS party_name,
                      (SELECT c.id FROM invoices c WHERE c.source_document_id = i.id LIMIT 1) AS converted_to_id
               FROM invoices i LEFT JOIN ledgers l ON i.party_ledger_id = l.id
               WHERE i.company_id = $1`;
    if (type) {
        params.push(type);
        sql += ` AND i.type = $${params.length}`;
    }
    if (paymentStatus) {
        params.push(paymentStatus);
        sql += ` AND i.payment_status = $${params.length}`;
    }
    if (fromDate) {
        params.push(fromDate);
        sql += ` AND i.date >= $${params.length}`;
    }
    if (toDate) {
        params.push(toDate);
        sql += ` AND i.date <= $${params.length}`;
    }
    if (partyLedgerId) {
        params.push(partyLedgerId);
        sql += ` AND i.party_ledger_id = $${params.length}`;
    }
    sql += ' ORDER BY i.date DESC, i.created_at DESC';
    return (await query(sql, params)).rows;
};

export const getInvoiceDetail = async (companyId: string, id: string) => {
    const invoiceRes = await query(
        `SELECT i.*, l.name AS party_name, l.gstin AS party_gstin, l.state AS party_state,
                l.email AS party_email, l.phone AS party_phone, l.address AS party_address,
                sl.name AS sales_ledger_name, c.name AS company_name, c.gstin AS company_gstin,
                c.state AS company_state,
                src.invoice_number AS source_document_number, src.type AS source_document_type,
                (SELECT json_agg(json_build_object('id', d.id, 'number', d.invoice_number, 'type', d.type))
                   FROM invoices d WHERE d.source_document_id = i.id) AS converted_to
         FROM invoices i
         LEFT JOIN invoices src ON src.id = i.source_document_id
         LEFT JOIN ledgers l ON i.party_ledger_id = l.id
         LEFT JOIN ledgers sl ON i.sales_ledger_id = sl.id
         LEFT JOIN companies c ON i.company_id = c.id
         WHERE i.id = $1 AND i.company_id = $2`,
        [id, companyId]
    );
    if (!invoiceRes.rows.length) throw new AppError('Invoice not found', 404);

    const items = await query(
        `SELECT ii.*, it.name AS item_name, it.hsn_code, u.symbol AS unit_symbol
         FROM invoice_items ii
         LEFT JOIN items it ON ii.item_id = it.id
         LEFT JOIN units u ON it.unit_id = u.id
         WHERE ii.invoice_id = $1 ORDER BY ii.created_at, ii.id`,
        [id]
    );
    const payments = await query(
        `SELECT p.*, l.name AS deposit_ledger_name FROM payments p
         LEFT JOIN ledgers l ON l.id = p.deposit_ledger_id
         WHERE p.invoice_id = $1 ORDER BY p.payment_date DESC`,
        [id]
    );
    return { invoice: invoiceRes.rows[0], items: items.rows, payments: payments.rows };
};

export const nextInvoiceNumber = (companyId: string, type: string, date: string) =>
    withTransaction(async (db) => peekNextNumber(db, companyId, type, await resolveFinancialYear(db, companyId, toDateString(date))));
