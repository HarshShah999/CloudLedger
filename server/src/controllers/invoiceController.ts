import { Request, Response } from 'express';
import { query, withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { renderInvoicePdf, INVOICE_COPIES, InvoiceCopy } from '../services/pdf/invoicePdf';
import { renderThermalPdf } from '../services/pdf/thermalPdf';
import { loadInvoiceDocument } from '../services/documentService';
import { shareInvoice, revokeShares, logCommunication, listCommunications, Channel } from '../services/shareService';
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
    QUOTATION: 'Quotation',
    SALES_ORDER: 'Sales Order',
    PURCHASE_ORDER: 'Purchase Order',
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
    const result = await query(sql, params);
    res.status(200).json({ status: 'success', data: { invoices: result.rows } });
};

export const getInvoiceById = async (req: Request, res: Response) => {
    const { id } = req.params;
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

/** ?format=thermal for 80 mm receipts; ?copies=original,duplicate,triplicate (or "all") for marked copies. */
export const parsePdfOptions = (q: Request['query']) => {
    const raw = String(q.copies || '').toLowerCase();
    const copies = (raw === 'all' ? INVOICE_COPIES : raw.split(',').filter((c) => INVOICE_COPIES.includes(c as InvoiceCopy))) as InvoiceCopy[];
    return { thermal: q.format === 'thermal', copies };
};

export const downloadInvoicePDF = async (req: Request, res: Response) => {
    const d = await loadInvoiceDocument(req.params.id);
    const o = parsePdfOptions(req.query);
    const buffer = o.thermal ? await renderThermalPdf(d) : await renderInvoicePdf(d, { copies: o.copies });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
        'Content-Disposition',
        `${req.query.inline ? 'inline' : 'attachment'}; filename="${safeFilename(d.invoice.invoice_number)}.pdf"`
    );
    res.send(buffer);
};

/** Creates a secure public link and returns ready-made WhatsApp / email / UPI share data. */
export const createInvoiceShare = async (req: Request, res: Response) => {
    const data = await shareInvoice(req.company!.id, req.params.id, req.user!.id);
    res.status(201).json({ status: 'success', data });
};

/** Withdraws every public link to this invoice. */
export const revokeInvoiceShares = async (req: Request, res: Response) => {
    const revoked = await revokeShares(req.company!.id, 'INVOICE', req.params.id);
    res.status(200).json({ status: 'success', data: { revoked } });
};

const CHANNELS: Channel[] = ['WHATSAPP', 'LINK', 'NATIVE', 'DOWNLOAD', 'PRINT', 'SMS'];

/** Records a share the browser performed itself (WhatsApp, copy link, native share, print). */
export const logInvoiceShare = async (req: Request, res: Response) => {
    const channel = String(req.body.channel || '').toUpperCase() as Channel;
    if (!CHANNELS.includes(channel)) throw new AppError('Unknown channel', 400);
    await logCommunication({
        companyId: req.company!.id, docType: 'INVOICE', docId: req.params.id, channel,
        recipient: req.body.recipient ? String(req.body.recipient).slice(0, 255) : null, userId: req.user!.id,
    });
    res.status(201).json({ status: 'success' });
};

export const getInvoiceCommunications = async (req: Request, res: Response) => {
    res.status(200).json({
        status: 'success',
        data: { communications: await listCommunications(req.company!.id, 'INVOICE', req.params.id) },
    });
};

export const sendInvoiceEmail = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { to, cc, subject, message } = req.body;
    const share = await shareInvoice(req.company!.id, id, req.user!.id);
    const d = await loadInvoiceDocument(id);
    const recipient = to || d.party.email;
    if (!recipient) throw new AppError('No recipient email address. Add an email to the party or type one.', 400);

    const label = DOC_LABEL[d.invoice.type] || 'Invoice';
    const mailSubject = subject || share.email.subject;
    const body = message || share.message;
    const pdf = await renderInvoicePdf(d);

    try {
        await sendMail({
            to: recipient,
            cc,
            subject: mailSubject,
            fromName: d.company.name,
            replyTo: d.company.email || undefined,
            text: body,
            html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
                     <p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>
                     <p><a href="${escapeHtml(share.url)}" style="display:inline-block;padding:10px 16px;background:#4338CA;color:#fff;border-radius:6px;text-decoration:none">View ${escapeHtml(label)}</a></p>
                     <table cellpadding="4" style="font-size:13px;color:#374151">
                       <tr><td>${escapeHtml(label)} No</td><td><b>${escapeHtml(d.invoice.invoice_number)}</b></td></tr>
                       <tr><td>Amount</td><td><b>${escapeHtml(formatINR(d.totals.grandTotal))}</b></td></tr>
                       ${d.totals.balance > 0 && d.totals.balance !== d.totals.grandTotal ? `<tr><td>Balance due</td><td><b>${escapeHtml(formatINR(d.totals.balance))}</b></td></tr>` : ''}
                     </table>
                   </div>`,
            attachments: [{ filename: share.fileName, content: pdf }],
        });
        await logCommunication({ companyId: req.company!.id, docType: 'INVOICE', docId: id, channel: 'EMAIL', recipient, subject: mailSubject, userId: req.user!.id });
    } catch (err: any) {
        await logCommunication({
            companyId: req.company!.id, docType: 'INVOICE', docId: id, channel: 'EMAIL', recipient, subject: mailSubject,
            status: 'FAILED', error: String(err.message).slice(0, 500), userId: req.user!.id,
        });
        if (err instanceof AppError) throw err;
        throw new AppError(`Failed to send email: ${err.message}`, 502);
    }

    res.status(200).json({ status: 'success', message: 'Email sent successfully', data: { recipient, subject: mailSubject } });
};

/** POST /invoices/:id/convert { to, date?, invoiceNumber?, dueDate? } */
export const convertInvoice = async (req: Request, res: Response) => {
    const invoice = await withTransaction((db) =>
        invoiceService.convertDocument(db, req.company!.id, req.params.id, req.body.to, {
            date: req.body.date, invoiceNumber: req.body.invoiceNumber, dueDate: req.body.dueDate,
        })
    );
    res.status(201).json({ status: 'success', data: { invoice } });
};

/** PATCH /invoices/:id/status { status } for quotations and orders */
export const updateDocumentStatus = async (req: Request, res: Response) => {
    const invoice = await withTransaction((db) => invoiceService.setDocumentStatus(db, req.company!.id, req.params.id, String(req.body.status || '')));
    res.json({ status: 'success', data: { invoice } });
};
