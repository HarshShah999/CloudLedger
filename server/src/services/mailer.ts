import nodemailer from 'nodemailer';
import { AppError } from '../middleware/errorHandler';

export const escapeHtml = (s: unknown) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let transporter: nodemailer.Transporter | null = null;

/** Messages captured when MAIL_TRANSPORT=json (tests / local development without SMTP). */
export const capturedMail: any[] = [];

const getTransporter = () => {
    if (process.env.MAIL_TRANSPORT === 'json') {
        if (!transporter) transporter = nodemailer.createTransport({ jsonTransport: true });
        return transporter;
    }
    if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
        throw new AppError('Email is not configured on the server (SMTP_USER / SMTP_PASSWORD)', 503);
    }
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_PORT === '465',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
        });
    }
    return transporter;
};

export interface MailInput {
    to: string;
    cc?: string;
    subject: string;
    text: string;
    html: string;
    fromName?: string;
    replyTo?: string;
    attachments?: { filename: string; content: Buffer }[];
}

export const sendMail = async (m: MailInput) => {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@taalmelbooks.in';
    if (process.env.MAIL_TRANSPORT === 'json') capturedMail.push(m);
    await getTransporter().sendMail({
        from: m.fromName ? `"${m.fromName.replace(/"/g, '')}" <${from}>` : from,
        to: m.to,
        cc: m.cc || undefined,
        replyTo: m.replyTo || undefined,
        subject: m.subject,
        text: m.text,
        html: m.html,
        attachments: m.attachments,
    });
};
