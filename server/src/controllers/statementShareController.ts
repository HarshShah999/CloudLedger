import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { loadCompanyProfile } from '../services/documentService';
import { renderStatementPdf } from '../services/pdf/statementPdf';
import { shareStatement, logCommunication, Channel } from '../services/shareService';
import { escapeHtml, sendMail } from '../services/mailer';
import { loadStatementForShare } from './publicController';
import { fyStartFor } from '../services/reportService';
import { query } from '../config/db';
import { toDateString } from '../services/financialYear';

const period = async (req: Request) => {
    const src = { ...req.query, ...(req.body || {}) } as Record<string, any>;
    const to = String(src.endDate || toDateString(new Date())).slice(0, 10);
    const from = String(src.startDate || (await fyStartFor({ query }, req.company!.id, to))).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        throw new AppError('Invalid statement period', 400);
    }
    return { from, to };
};

export const downloadStatementPdf = async (req: Request, res: Response) => {
    const { from, to } = await period(req);
    const company = await loadCompanyProfile(req.company!.id);
    const s = await loadStatementForShare(req.company!.id, req.params.ledgerId, from, to);
    const pdf = await renderStatementPdf(company, s);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
        'Content-Disposition',
        `${req.query.inline ? 'inline' : 'attachment'}; filename="Statement-${s.ledger.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf"`
    );
    res.send(pdf);
};

export const createStatementShare = async (req: Request, res: Response) => {
    const { from, to } = await period(req);
    const data = await shareStatement(req.company!.id, req.params.ledgerId, from, to, req.user!.id);
    res.status(201).json({ status: 'success', data });
};

export const logStatementShare = async (req: Request, res: Response) => {
    const channel = String(req.body.channel || '').toUpperCase() as Channel;
    if (!['WHATSAPP', 'LINK', 'NATIVE', 'DOWNLOAD', 'PRINT', 'SMS'].includes(channel)) throw new AppError('Unknown channel', 400);
    await logCommunication({
        companyId: req.company!.id, docType: 'LEDGER_STATEMENT', docId: req.params.ledgerId, channel,
        recipient: req.body.recipient ? String(req.body.recipient).slice(0, 255) : null, userId: req.user!.id,
    });
    res.status(201).json({ status: 'success' });
};

export const emailStatement = async (req: Request, res: Response) => {
    const { from, to } = await period(req);
    const share = await shareStatement(req.company!.id, req.params.ledgerId, from, to, req.user!.id);
    const recipient = req.body.to || share.email.to;
    if (!recipient) throw new AppError('No recipient email address. Add an email to the ledger or type one.', 400);
    const company = await loadCompanyProfile(req.company!.id);
    const s = await loadStatementForShare(req.company!.id, req.params.ledgerId, from, to);
    const pdf = await renderStatementPdf(company, s);
    const subject = req.body.subject || share.email.subject;
    const body = req.body.message || share.message;
    try {
        await sendMail({
            to: recipient,
            cc: req.body.cc,
            subject,
            fromName: company.name,
            replyTo: company.email || undefined,
            text: body,
            html: `<div style="font-family:Arial,sans-serif;font-size:14px">${escapeHtml(body).replace(/\n/g, '<br>')}</div>`,
            attachments: [{ filename: share.fileName, content: pdf }],
        });
        await logCommunication({ companyId: req.company!.id, docType: 'LEDGER_STATEMENT', docId: req.params.ledgerId, channel: 'EMAIL', recipient, subject, userId: req.user!.id });
    } catch (err: any) {
        await logCommunication({
            companyId: req.company!.id, docType: 'LEDGER_STATEMENT', docId: req.params.ledgerId, channel: 'EMAIL', recipient, subject,
            status: 'FAILED', error: String(err.message).slice(0, 500), userId: req.user!.id,
        });
        if (err instanceof AppError) throw err;
        throw new AppError(`Failed to send email: ${err.message}`, 502);
    }
    res.status(200).json({ status: 'success', message: 'Email sent successfully', data: { recipient } });
};
