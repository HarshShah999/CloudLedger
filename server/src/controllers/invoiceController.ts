import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { pdfToBuffer } from '../utils/pdfBuffer';
import * as invoiceService from '../services/invoiceService';
import { resolveFinancialYear, toDateString } from '../services/financialYear';
import { peekNextNumber } from '../services/numberSeries';
import { escapeHtml, sendMail } from '../services/mailer';
import { formatINR } from '../utils/money';

const DOC_LABEL: Record<string, string> = {
    SALES: 'Invoice',
    PURCHASE: 'Purchase Bill',
    CREDIT_NOTE: 'Credit Note',
    DEBIT_NOTE: 'Debit Note',
};

const safeFilename = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-');

export const createInvoice = async (req: Request, res: Response) => {
    const invoice = await withTransaction((db) => invoiceService.createInvoice(db, req.company!.id, req.body));
    res.status(201).json({ status: 'success', data: { invoice } });
};

export const updateInvoice = async (req: Request, res: Response) => {
    const invoice = await withTransaction((db) =>
        invoiceService.updateInvoice(db, req.company!.id, req.params.id, req.body)
    );
    res.status(200).json({ status: 'success', data: { invoice } });
};

export const deleteInvoice = async (req: Request, res: Response) => {
    await withTransaction((db) => invoiceService.deleteInvoice(db, req.company!.id, req.params.id));
    res.status(204).send();
};

/** Next document number for a type and date, for pre-filling the entry form. */
export const getNextNumber = async (req: Request, res: Response) => {
    const type = String(req.query.type || 'SALES');
    const date = toDateString(String(req.query.date || toDateString(new Date())));
    const number = await withTransaction(async (db) => {
        const fy = await resolveFinancialYear(db, req.company!.id, date);
        return peekNextNumber(db, req.company!.id, type, fy);
    });
    res.status(200).json({ status: 'success', data: { number } });
};

export const getInvoices = async (req: Request, res: Response) => {
    const { type, paymentStatus, fromDate, toDate, partyLedgerId } = req.query;
    const params: any[] = [req.company!.id];
    let sql = `SELECT i.*, l.name AS party_name
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
    const result = await query(sql, params);
    res.status(200).json({ status: 'success', data: { invoices: result.rows } });
};

export const getInvoiceById = async (req: Request, res: Response) => {
    const { id } = req.params;
    const invoiceRes = await query(
        `SELECT i.*, l.name AS party_name, l.gstin AS party_gstin, l.state AS party_state,
                l.email AS party_email, l.phone AS party_phone, l.address AS party_address,
                sl.name AS sales_ledger_name, c.name AS company_name, c.gstin AS company_gstin,
                c.state AS company_state
         FROM invoices i
         LEFT JOIN ledgers l ON i.party_ledger_id = l.id
         LEFT JOIN ledgers sl ON i.sales_ledger_id = sl.id
         LEFT JOIN companies c ON i.company_id = c.id
         WHERE i.id = $1 AND i.company_id = $2`,
        [id, req.company!.id]
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
    res.status(200).json({
        status: 'success',
        data: { invoice: invoiceRes.rows[0], items: items.rows, payments: payments.rows },
    });
};

export const downloadInvoicePDF = async (req: Request, res: Response) => {
    const { id } = req.params;
    const inv = await query('SELECT invoice_number FROM invoices WHERE id = $1', [id]);
    const buffer = await pdfToBuffer(await generateInvoicePDF(id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(inv.rows[0]?.invoice_number || id)}.pdf"`);
    res.send(buffer);
};

export const sendInvoiceEmail = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { to, cc, subject, message } = req.body;

    const r = await query(
        `SELECT i.*, l.email AS party_email, l.name AS party_name, c.name AS company_name, c.email AS company_email
         FROM invoices i
         LEFT JOIN ledgers l ON i.party_ledger_id = l.id
         LEFT JOIN companies c ON c.id = i.company_id
         WHERE i.id = $1 AND i.company_id = $2`,
        [id, req.company!.id]
    );
    if (!r.rows.length) throw new AppError('Invoice not found', 404);
    const invoice = r.rows[0];
    const recipient = to || invoice.party_email;
    if (!recipient) throw new AppError('No recipient email address provided', 400);

    const label = DOC_LABEL[invoice.type] || 'Invoice';
    const mailSubject = subject || `${label} ${invoice.invoice_number} from ${invoice.company_name}`;
    const body = message || `Please find attached ${label.toLowerCase()} ${invoice.invoice_number}.`;
    const pdf = await pdfToBuffer(await generateInvoicePDF(id));

    try {
        await sendMail({
            to: recipient,
            cc,
            subject: mailSubject,
            fromName: invoice.company_name,
            replyTo: invoice.company_email,
            text: `Dear ${invoice.party_name},\n\n${body}\n\n${label} No: ${invoice.invoice_number}\nDate: ${invoice.date}\nAmount: ${formatINR(invoice.grand_total)}\n\nThank you for your business!\n${invoice.company_name}`,
            html: `<p>Dear ${escapeHtml(invoice.party_name)},</p>
                   <p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>
                   <table cellpadding="4">
                     <tr><td>${label} No</td><td><b>${escapeHtml(invoice.invoice_number)}</b></td></tr>
                     <tr><td>Date</td><td>${escapeHtml(invoice.date)}</td></tr>
                     <tr><td>Amount</td><td><b>${escapeHtml(formatINR(invoice.grand_total))}</b></td></tr>
                   </table>
                   <p>Thank you for your business!<br>${escapeHtml(invoice.company_name)}</p>`,
            attachments: [{ filename: `${safeFilename(invoice.invoice_number)}.pdf`, content: pdf }],
        });
        await query(`INSERT INTO email_logs (invoice_id, recipient, cc, subject, status) VALUES ($1,$2,$3,$4,'SENT')`, [
            id, recipient, cc || null, mailSubject,
        ]);
    } catch (err: any) {
        await query(`INSERT INTO email_logs (invoice_id, recipient, cc, subject, status) VALUES ($1,$2,$3,$4,'FAILED')`, [
            id, recipient, cc || null, mailSubject,
        ]);
        if (err instanceof AppError) throw err;
        throw new AppError(`Failed to send email: ${err.message}`, 502);
    }

    res.status(200).json({ status: 'success', message: 'Email sent successfully', data: { recipient, subject: mailSubject } });
};
