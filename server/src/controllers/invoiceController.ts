import { Request, Response } from 'express';
import { withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { renderInvoicePdf, INVOICE_COPIES, InvoiceCopy } from '../services/pdf/invoicePdf';
import { renderThermalPdf } from '../services/pdf/thermalPdf';
import { buildEinvoice, buildEinvoiceBulk, recordIrn, cancelIrn } from '../services/einvoiceService';
import { buildEwayBill, buildEwayBillBulk, recordEwayBill } from '../services/ewaybillService';
import { loadInvoiceDocument } from '../services/documentService';
import { shareInvoice, revokeShares, logCommunication, listCommunications, Channel } from '../services/shareService';
import * as invoiceService from '../services/invoiceService';
import * as invoiceQueries from '../services/invoiceQueries';
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

/** POST /api/invoices/:id/cancel { reason? } */
export const cancelInvoice = async (req: Request, res: Response) => {
    const invoice = await withTransaction((db) => invoiceService.cancelInvoice(db, req.company!.id, req.params.id, req.body?.reason));
    res.json({ status: 'success', data: { invoice } });
};

export const deleteInvoice = async (req: Request, res: Response) => {
    await withTransaction((db) => invoiceService.deleteInvoice(db, req.company!.id, req.params.id));
    res.status(204).send();
};

/** Next document number for a type and date, for pre-filling the entry form. */
export const getNextNumber = async (req: Request, res: Response) => {
    const number = await invoiceQueries.nextInvoiceNumber(req.company!.id, String(req.query.type || 'SALES'), String(req.query.date || toDateString(new Date())));
    res.status(200).json({ status: 'success', data: { number } });
};

export const getInvoices = async (req: Request, res: Response) => {
    const invoices = await invoiceQueries.listInvoices(req.company!.id, req.query as invoiceQueries.InvoiceFilters);
    res.status(200).json({ status: 'success', data: { invoices } });
};

export const getInvoiceById = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: await invoiceQueries.getInvoiceDetail(req.company!.id, req.params.id) });
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

/* ---------- E-invoice (IRN) and e-way bill ---------- */

const jsonDownload = (res: Response, name: string, body: unknown) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(JSON.stringify(body, null, 2));
};

const readPeriodQuery = (req: Request) => {
    const from = String(req.query.fromDate || '').slice(0, 10);
    const to = String(req.query.toDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError('fromDate and toDate are required', 400);
    return { from, to };
};

/** GET /invoices/:id/einvoice — payload + problems; ?download=1 returns the JSON file. */
export const getEinvoice = async (req: Request, res: Response) => {
    const e = await buildEinvoice(req.params.id);
    if (req.query.download) {
        if (e.problems.length) throw new AppError(`Fix before uploading: ${e.problems.join('; ')}`, 400);
        return jsonDownload(res, `einvoice-${safeFilename(e.invoice.number)}.json`, [e.json]);
    }
    res.json({ status: 'success', data: e });
};

/** GET /invoices/einvoice/bulk?companyId&fromDate&toDate — all pending IRNs as one upload file. */
export const getEinvoiceBulk = async (req: Request, res: Response) => {
    const { from, to } = readPeriodQuery(req);
    const r = await buildEinvoiceBulk(req.company!.id, from, to);
    if (req.query.download) return jsonDownload(res, `einvoices-${from}-to-${to}.json`, r.docs);
    res.json({ status: 'success', data: { count: r.docs.length, problems: r.problems } });
};

export const postIrn = async (req: Request, res: Response) => {
    await recordIrn(req.company!.id, req.params.id, req.body);
    res.json({ status: 'success' });
};

export const postCancelIrn = async (req: Request, res: Response) => {
    await cancelIrn(req.company!.id, req.params.id);
    res.json({ status: 'success' });
};

export const getEwayBill = async (req: Request, res: Response) => {
    const e = await buildEwayBill(req.params.id);
    if (req.query.download) {
        if (e.problems.length) throw new AppError(`Fix before uploading: ${e.problems.join('; ')}`, 400);
        return jsonDownload(res, `ewaybill-${safeFilename(e.invoice.number)}.json`, { version: '1.0.0621', billLists: [e.bill] });
    }
    res.json({ status: 'success', data: e });
};

/** POST /invoices/ewaybill/bulk { companyId, invoiceIds } — one bulk-upload file. */
export const postEwayBillBulk = async (req: Request, res: Response) => {
    const ids: string[] = Array.isArray(req.body.invoiceIds) ? req.body.invoiceIds : [];
    const r = await buildEwayBillBulk(req.company!.id, ids);
    res.json({ status: 'success', data: r });
};

export const postEwayBillNumber = async (req: Request, res: Response) => {
    await recordEwayBill(req.company!.id, req.params.id, req.body);
    res.json({ status: 'success' });
};
