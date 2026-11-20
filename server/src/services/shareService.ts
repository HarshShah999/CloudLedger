import crypto from 'crypto';
import { query, Queryable } from '../config/db';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import {
    DOC_SHORT, buildShareMessage, loadCompanyProfile, loadInvoiceDocument, whatsappUrl, whatsappNumber,
} from './documentService';

export type ShareDocType = 'INVOICE' | 'LEDGER_STATEMENT';
export type Channel = 'EMAIL' | 'WHATSAPP' | 'LINK' | 'NATIVE' | 'DOWNLOAD' | 'PRINT' | 'SMS';

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Base URL of the web app, used to build public links (first CLIENT_URL entry by default). */
export const publicAppUrl = () => (process.env.PUBLIC_APP_URL || env.clientUrl.split(',')[0]).replace(/\/+$/, '');

export const createShareLink = async (
    db: Queryable,
    input: { companyId: string; docType: ShareDocType; docId: string; params?: object; userId?: string; days?: number }
) => {
    const token = crypto.randomBytes(24).toString('base64url');
    const days = Math.min(Math.max(input.days ?? 30, 1), 365);
    const r = await db.query(
        `INSERT INTO document_shares (company_id, doc_type, doc_id, params, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' days')::interval, $7) RETURNING expires_at`,
        [input.companyId, input.docType, input.docId, JSON.stringify(input.params ?? {}), hashToken(token), String(days), input.userId ?? null]
    );
    return { token, url: `${publicAppUrl()}/v/${token}`, expiresAt: r.rows[0].expires_at as Date };
};

/** Looks up a live share by token and counts the view. Throws 404 for unknown, expired or revoked links. */
export const resolveShareToken = async (token: string, countView = true) => {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new AppError('This link is invalid', 404);
    const r = await query(
        `${countView ? 'UPDATE document_shares SET view_count = view_count + 1, last_viewed_at = NOW()' : 'SELECT * FROM document_shares'}
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW() ${countView ? 'RETURNING *' : ''}`,
        [hashToken(token)]
    );
    if (!r.rows.length) throw new AppError('This link has expired or was withdrawn. Please ask the sender for a new one.', 404);
    return r.rows[0] as { company_id: string; doc_type: ShareDocType; doc_id: string; params: any; expires_at: Date };
};

export const revokeShares = async (companyId: string, docType: ShareDocType, docId: string) => {
    const r = await query(
        `UPDATE document_shares SET revoked_at = NOW()
         WHERE company_id = $1 AND doc_type = $2 AND doc_id = $3 AND revoked_at IS NULL`,
        [companyId, docType, docId]
    );
    return r.rowCount ?? 0;
};

export const logCommunication = async (input: {
    companyId: string;
    docType: ShareDocType;
    docId: string;
    channel: Channel;
    recipient?: string | null;
    subject?: string | null;
    status?: 'SENT' | 'FAILED' | 'OPENED';
    error?: string | null;
    userId?: string | null;
}) => {
    await query(
        `INSERT INTO communication_logs (company_id, doc_type, doc_id, channel, recipient, subject, status, error, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
            input.companyId, input.docType, input.docId, input.channel, input.recipient ?? null, input.subject ?? null,
            input.status ?? 'SENT', input.error ?? null, input.userId ?? null,
        ]
    );
};

export const listCommunications = async (companyId: string, docType: ShareDocType, docId: string) =>
    (
        await query(
            `SELECT c.id, c.channel, c.recipient, c.subject, c.status, c.error, c.created_at, u.name AS sent_by
             FROM communication_logs c LEFT JOIN users u ON u.id = c.created_by
             WHERE c.company_id = $1 AND c.doc_type = $2 AND c.doc_id = $3
             ORDER BY c.created_at DESC LIMIT 50`,
            [companyId, docType, docId]
        )
    ).rows;

/** Everything the client needs to share an invoice on any channel in one click. */
export const shareInvoice = async (companyId: string, invoiceId: string, userId?: string) => {
    const d = await loadInvoiceDocument(invoiceId);
    if (d.invoice.company_id !== companyId) throw new AppError('Invoice not found', 404);
    const link = await createShareLink({ query }, {
        companyId, docType: 'INVOICE', docId: invoiceId, userId, days: d.company.share_link_days,
    });
    const message = buildShareMessage(d, link.url);
    const label = DOC_SHORT[d.invoice.type] || 'Invoice';
    return {
        url: link.url,
        expiresAt: link.expiresAt,
        message,
        whatsappUrl: whatsappUrl(d.party.phone, message),
        whatsappNumber: whatsappNumber(d.party.phone),
        email: { to: d.party.email, subject: `${label} ${d.invoice.invoice_number} from ${d.company.name}`, body: message },
        upiLink: d.upiLink,
        fileName: `${d.invoice.invoice_number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`,
        party: { name: d.party.name, phone: d.party.phone, email: d.party.email },
    };
};

/** Share info for a ledger (party) statement over a period. */
export const shareStatement = async (companyId: string, ledgerId: string, from: string, to: string, userId?: string) => {
    const company = await loadCompanyProfile(companyId);
    const l = await query('SELECT name, phone, email FROM ledgers WHERE id = $1 AND company_id = $2', [ledgerId, companyId]);
    if (!l.rows.length) throw new AppError('Ledger not found', 404);
    const ledger = l.rows[0];
    const link = await createShareLink({ query }, {
        companyId, docType: 'LEDGER_STATEMENT', docId: ledgerId, params: { from, to }, userId, days: company.share_link_days,
    });
    const message =
        `Dear ${ledger.name},\n\nPlease find your statement of account with ${company.name} ` +
        `for ${from.split('-').reverse().join('-')} to ${to.split('-').reverse().join('-')}.\n\n` +
        `View / download: ${link.url}\n\nThank you,\n${company.name}`;
    return {
        url: link.url,
        expiresAt: link.expiresAt,
        message,
        whatsappUrl: whatsappUrl(ledger.phone, message),
        whatsappNumber: whatsappNumber(ledger.phone),
        email: { to: ledger.email, subject: `Statement of account from ${company.name}`, body: message },
        upiLink: null,
        fileName: `Statement-${ledger.name.replace(/[^A-Za-z0-9._-]+/g, '-')}-${from}-to-${to}.pdf`,
        party: { name: ledger.name, phone: ledger.phone, email: ledger.email },
    };
};

