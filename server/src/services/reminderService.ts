import { query } from '../config/db';
import { formatINR, toPaise } from '../utils/money';
import { toDateString } from './financialYear';
import { loadInvoiceDocument } from './documentService';
import { renderInvoicePdf } from './pdf/invoicePdf';
import { createShareLink, logCommunication } from './shareService';
import { escapeHtml, sendMail } from './mailer';
import { sendWhatsAppTemplate, whatsappConfigured } from './whatsappService';

export type Channel = 'EMAIL' | 'WHATSAPP';

const dmy = (d: string) => d.split('-').reverse().join('-');

export const parseOffsets = (s: string | null | undefined) =>
    [...new Set(String(s || '').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n) && n >= -60 && n <= 365))];

export const parseChannels = (s: string | null | undefined): Channel[] =>
    String(s || 'EMAIL').split(',').map((c) => c.trim().toUpperCase()).filter((c): c is Channel => c === 'EMAIL' || c === 'WHATSAPP');

/** Unpaid sales invoices whose due date is `offset` days before/after `today`. */
const dueInvoices = async (companyId: string, offsets: number[], today: string) =>
    (
        await query(
            `SELECT i.id, i.invoice_number, i.date, COALESCE(i.due_date, i.date) AS due_date, i.grand_total, i.tds_amount,
                    ($2::date - COALESCE(i.due_date, i.date)) AS day_offset,
                    i.grand_total - i.tds_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS outstanding,
                    l.name AS party_name, l.email AS party_email, l.phone AS party_phone
             FROM invoices i JOIN ledgers l ON l.id = i.party_ledger_id
             WHERE i.company_id = $1 AND i.type = 'SALES' AND COALESCE(i.status, '') <> 'CANCELLED'
               AND ($2::date - COALESCE(i.due_date, i.date)) = ANY($3::int[])`,
            [companyId, today, offsets]
        )
    ).rows.filter((r) => toPaise(r.outstanding) > 0);

/** What would be sent today, without sending (for the settings page). */
export const previewReminders = async (companyId: string, today = toDateString(new Date())) => {
    const c = (await query('SELECT * FROM companies WHERE id = $1', [companyId])).rows[0];
    const rows = await dueInvoices(companyId, parseOffsets(c.reminder_days), today);
    const channels = parseChannels(c.reminder_channels);
    return rows.map((r) => ({
        invoiceId: r.id,
        number: r.invoice_number,
        party: r.party_name,
        dueDate: r.due_date,
        dayOffset: r.day_offset,
        outstanding: Number(r.outstanding),
        channels: channels.map((ch) => ({
            channel: ch,
            ready: ch === 'EMAIL' ? !!r.party_email : !!r.party_phone && whatsappConfigured(c),
        })),
    }));
};

const reminderText = (r: any, companyName: string, link: string) => {
    const when =
        r.day_offset < 0 ? `is due on ${dmy(r.due_date)}` : r.day_offset === 0 ? 'is due today' : `was due on ${dmy(r.due_date)} (${r.day_offset} days ago)`;
    return (
        `Dear ${r.party_name},\n\nThis is a friendly reminder that invoice ${r.invoice_number} dated ${dmy(r.date)} ` +
        `for ${formatINR(Number(r.outstanding))} ${when}.\n\nView and pay: ${link}\n\nPlease ignore this if you have already paid.\n\nThank you,\n${companyName}`
    );
};

/**
 * Sends due reminders for one company on `today`. Each (invoice, day offset,
 * channel) is sent at most once, recorded in reminder_log.
 */
export const runCompanyReminders = async (companyId: string, today = toDateString(new Date())) => {
    const c = (await query('SELECT * FROM companies WHERE id = $1', [companyId])).rows[0];
    if (!c) return { sent: 0, failed: 0, skipped: 0 };
    const channels = parseChannels(c.reminder_channels);
    const rows = await dueInvoices(companyId, parseOffsets(c.reminder_days), today);
    const result = { sent: 0, failed: 0, skipped: 0 };

    for (const r of rows) {
        for (const ch of channels) {
            // Claim the slot first so concurrent runs never double-send
            const claim = await query(
                `INSERT INTO reminder_log (company_id, invoice_id, day_offset, channel, status)
                 VALUES ($1, $2, $3, $4, 'PENDING') ON CONFLICT DO NOTHING RETURNING id`,
                [companyId, r.id, r.day_offset, ch]
            );
            if (!claim.rows.length) continue;
            const logId = claim.rows[0].id;
            const finish = (status: string, detail?: string) =>
                query('UPDATE reminder_log SET status = $1, detail = $2 WHERE id = $3', [status, detail ?? null, logId]);

            try {
                const recipient = ch === 'EMAIL' ? r.party_email : r.party_phone;
                if (!recipient) {
                    await finish('SKIPPED', ch === 'EMAIL' ? 'Party has no email' : 'Party has no mobile number');
                    result.skipped++;
                    continue;
                }
                if (ch === 'WHATSAPP' && !whatsappConfigured(c)) {
                    await finish('SKIPPED', 'WhatsApp API is not set up');
                    result.skipped++;
                    continue;
                }
                const link = await createShareLink({ query }, { companyId, docType: 'INVOICE', docId: r.id, days: c.share_link_days });
                const text = reminderText(r, c.name, link.url);
                if (ch === 'EMAIL') {
                    const doc = await loadInvoiceDocument(r.id);
                    const pdf = await renderInvoicePdf(doc);
                    const subject = `Payment reminder: invoice ${r.invoice_number} – ${formatINR(Number(r.outstanding))}`;
                    await sendMail({
                        to: recipient,
                        subject,
                        fromName: c.name,
                        replyTo: c.email || undefined,
                        text,
                        html: `<div style="font-family:Arial,sans-serif;font-size:14px">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`,
                        attachments: [{ filename: `${r.invoice_number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`, content: pdf }],
                    });
                    await logCommunication({ companyId, docType: 'INVOICE', docId: r.id, channel: 'EMAIL', recipient, subject });
                } else {
                    // Template body variables: {{1}} party, {{2}} invoice no, {{3}} amount, {{4}} due date, {{5}} link
                    await sendWhatsAppTemplate(c, recipient, [r.party_name, r.invoice_number, formatINR(Number(r.outstanding)), dmy(r.due_date), link.url]);
                    await logCommunication({ companyId, docType: 'INVOICE', docId: r.id, channel: 'WHATSAPP', recipient, subject: 'Payment reminder' });
                }
                await finish('SENT');
                result.sent++;
            } catch (err) {
                await finish('FAILED', String((err as Error).message).slice(0, 500));
                result.failed++;
            }
        }
    }
    return result;
};

/** Daily job: all companies with reminders switched on. */
export const runAllReminders = async (today = toDateString(new Date())) => {
    const companies = (await query('SELECT id FROM companies WHERE reminders_enabled')).rows;
    const total = { sent: 0, failed: 0, skipped: 0 };
    for (const { id } of companies) {
        const r = await runCompanyReminders(id, today);
        total.sent += r.sent;
        total.failed += r.failed;
        total.skipped += r.skipped;
    }
    return total;
};

export const reminderHistory = async (companyId: string) =>
    (
        await query(
            `SELECT rl.*, i.invoice_number, l.name AS party_name FROM reminder_log rl
             JOIN invoices i ON i.id = rl.invoice_id JOIN ledgers l ON l.id = i.party_ledger_id
             WHERE rl.company_id = $1 ORDER BY rl.created_at DESC LIMIT 100`,
            [companyId]
        )
    ).rows;

