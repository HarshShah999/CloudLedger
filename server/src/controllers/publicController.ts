import { Request, Response } from 'express';
import QRCode from 'qrcode';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { resolveShareToken } from '../services/shareService';
import { loadCompanyProfile, loadInvoiceDocument, CompanyProfile } from '../services/documentService';
import { renderInvoicePdf } from '../services/pdf/invoicePdf';
import { renderStatementPdf } from '../services/pdf/statementPdf';
import { renderThermalPdf } from '../services/pdf/thermalPdf';
import { ledgerStatement } from '../services/reportService';
import { getAsset } from '../services/assetService';

/** Company fields that are already printed on documents, safe to show publicly. */
const publicCompany = (c: CompanyProfile) => ({
    name: c.name,
    address: c.address,
    phone: c.phone,
    email: c.email,
    gstin: c.gstin,
    state: c.state,
    website: c.website,
    has_logo: !!c.logo,
    brand_color: c.brand_color,
    upi_id: c.upi_id,
    bank: c.bank_account_number
        ? { name: c.bank_name, account_name: c.bank_account_name, account_number: c.bank_account_number, ifsc: c.bank_ifsc, branch: c.bank_branch }
        : null,
});

export const loadStatementForShare = async (companyId: string, ledgerId: string, from: string, to: string) => {
    const data = await ledgerStatement(companyId, ledgerId, from, to);
    if (!data) throw new AppError('Statement not found', 404);
    const party = (await query('SELECT gstin, address, phone FROM ledgers WHERE id = $1', [ledgerId])).rows[0];
    return { ...data, party };
};

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-');

/** GET /api/public/d/:token — the document behind a shared link, as JSON for the viewer page. */
export const getSharedDocument = async (req: Request, res: Response) => {
    const share = await resolveShareToken(req.params.token);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');

    if (share.doc_type === 'INVOICE') {
        const d = await loadInvoiceDocument(share.doc_id);
        const inv = d.invoice;
        res.json({
            status: 'success',
            data: {
                docType: 'INVOICE',
                title: d.title,
                expiresAt: share.expires_at,
                company: publicCompany(d.company),
                party: d.party,
                invoice: {
                    number: inv.invoice_number,
                    type: inv.type,
                    date: inv.date,
                    dueDate: inv.due_date,
                    placeOfSupply: inv.place_of_supply,
                    notes: inv.notes,
                    paymentStatus: inv.payment_status,
                    discountAmount: Number(inv.discount_amount || 0),
                },
                items: d.items.map((it) => ({
                    name: it.item_name || it.description,
                    description: it.item_name && it.description !== it.item_name ? it.description : null,
                    hsn: it.hsn_code,
                    quantity: Number(it.quantity),
                    unit: it.unit_symbol,
                    rate: Number(it.rate),
                    taxable: Number(it.taxable_amount),
                    taxRate: Number(it.tax_rate),
                    tax: Number(it.cgst_amount) + Number(it.sgst_amount) + Number(it.igst_amount),
                    total: Number(it.total_amount),
                })),
                totals: d.totals,
                amountInWords: d.amountInWords,
                upi: d.upiLink ? { link: d.upiLink, qr: await QRCode.toDataURL(d.upiLink, { margin: 1, width: 220 }) } : null,
            },
        });
        return;
    }

    if (share.doc_type === 'LEDGER_STATEMENT') {
        const company = await loadCompanyProfile(share.company_id);
        const s = await loadStatementForShare(share.company_id, share.doc_id, share.params.from, share.params.to);
        res.json({
            status: 'success',
            data: {
                docType: 'LEDGER_STATEMENT',
                title: 'Statement of Account',
                expiresAt: share.expires_at,
                company: publicCompany(company),
                statement: s,
            },
        });
        return;
    }
    throw new AppError('Unsupported document', 404);
};

/** GET /api/public/d/:token/pdf — PDF of a shared document (?download=1 forces a download). */
export const getSharedPdf = async (req: Request, res: Response) => {
    const share = await resolveShareToken(req.params.token, false);
    let pdf: Buffer;
    let name: string;
    if (share.doc_type === 'INVOICE') {
        const d = await loadInvoiceDocument(share.doc_id);
        pdf = req.query.format === 'thermal' ? await renderThermalPdf(d) : await renderInvoicePdf(d);
        name = `${safeName(d.invoice.invoice_number)}.pdf`;
    } else {
        const company = await loadCompanyProfile(share.company_id);
        const s = await loadStatementForShare(share.company_id, share.doc_id, share.params.from, share.params.to);
        pdf = await renderStatementPdf(company, s);
        name = `Statement-${safeName(s.ledger.name)}.pdf`;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${name}"`);
    res.send(pdf);
};

/** GET /api/public/d/:token/logo — the sender's logo for the public page. */
export const getSharedLogo = async (req: Request, res: Response) => {
    const share = await resolveShareToken(req.params.token, false);
    const logo = await getAsset(share.company_id, 'logo');
    if (!logo) throw new AppError('No logo', 404);
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(logo.data);
};
