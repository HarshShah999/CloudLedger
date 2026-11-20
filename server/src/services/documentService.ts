import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { fromPaise, toPaise, formatINR } from '../utils/money';
import { amountInWords } from '../utils/words';

export const DOC_TITLES: Record<string, string> = {
    SALES: 'Tax Invoice',
    PURCHASE: 'Purchase Bill',
    CREDIT_NOTE: 'Credit Note',
    DEBIT_NOTE: 'Debit Note',
    QUOTATION: 'Quotation',
    SALES_ORDER: 'Sales Order',
    PURCHASE_ORDER: 'Purchase Order',
};

export const DOC_SHORT: Record<string, string> = {
    SALES: 'Invoice',
    PURCHASE: 'Bill',
    CREDIT_NOTE: 'Credit Note',
    DEBIT_NOTE: 'Debit Note',
    QUOTATION: 'Quotation',
    SALES_ORDER: 'Sales Order',
    PURCHASE_ORDER: 'Purchase Order',
};

export interface CompanyProfile {
    id: string;
    name: string;
    address: string | null;
    email: string | null;
    phone: string | null;
    gstin: string | null;
    pan: string | null;
    state: string | null;
    website: string | null;
    upi_id: string | null;
    bank_name: string | null;
    bank_account_name: string | null;
    bank_account_number: string | null;
    bank_ifsc: string | null;
    bank_branch: string | null;
    invoice_terms: string | null;
    share_message_template: string | null;
    share_link_days: number;
    brand_color: string;
    print_copy_labels: boolean;
    /** Images (PNG/JPEG) loaded from company_assets */
    logo?: Buffer | null;
    signature?: Buffer | null;
}

export const loadCompanyProfile = async (companyId: string): Promise<CompanyProfile> => {
    const r = await query('SELECT * FROM companies WHERE id = $1', [companyId]);
    if (!r.rows.length) throw new AppError('Company not found', 404);
    const assets = await query('SELECT kind, data FROM company_assets WHERE company_id = $1', [companyId]);
    const img = (k: string) => assets.rows.find((a) => a.kind === k)?.data ?? null;
    return { ...r.rows[0], logo: img('logo'), signature: img('signature') };
};

/** UPI deep link (works with GPay, PhonePe, Paytm, BHIM…). Null if no UPI ID or nothing to pay. */
export const upiLink = (company: Pick<CompanyProfile, 'upi_id' | 'name'>, amount: number, note: string): string | null => {
    if (!company.upi_id || !(amount > 0)) return null;
    const params = new URLSearchParams({
        pa: company.upi_id.trim(),
        pn: company.name.slice(0, 50),
        am: fromPaise(toPaise(amount)).toFixed(2),
        cu: 'INR',
        tn: note.slice(0, 50),
    });
    return `upi://pay?${params.toString()}`;
};

export interface InvoiceDocument {
    company: CompanyProfile;
    invoice: any;
    party: { name: string; gstin: string | null; state: string | null; address: string | null; phone: string | null; email: string | null };
    items: any[];
    hsnSummary: { hsn: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
    totals: { taxable: number; cgst: number; sgst: number; igst: number; roundOff: number; grandTotal: number; paid: number; balance: number };
    title: string;
    amountInWords: string;
    isInterState: boolean;
    upiLink: string | null;
}

export const loadInvoiceDocument = async (invoiceId: string): Promise<InvoiceDocument> => {
    const r = await query(
        `SELECT i.*, l.name AS party_name, l.gstin AS party_gstin, l.state AS party_state, l.address AS party_address,
                l.phone AS party_phone, l.email AS party_email
         FROM invoices i LEFT JOIN ledgers l ON l.id = i.party_ledger_id
         WHERE i.id = $1`,
        [invoiceId]
    );
    if (!r.rows.length) throw new AppError('Invoice not found', 404);
    const invoice = r.rows[0];
    const company = await loadCompanyProfile(invoice.company_id);

    const items = (
        await query(
            `SELECT ii.*, it.name AS item_name, it.hsn_code, u.symbol AS unit_symbol
             FROM invoice_items ii
             LEFT JOIN items it ON it.id = ii.item_id
             LEFT JOIN units u ON u.id = it.unit_id
             WHERE ii.invoice_id = $1 ORDER BY ii.created_at, ii.id`,
            [invoiceId]
        )
    ).rows;

    const hsn = new Map<string, { hsn: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number }>();
    let taxable = 0, cgst = 0, sgst = 0, igst = 0;
    for (const it of items) {
        const key = `${it.hsn_code || '-'}|${Number(it.tax_rate)}`;
        const row = hsn.get(key) ?? { hsn: it.hsn_code || '-', rate: Number(it.tax_rate), taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        row.taxable += toPaise(it.taxable_amount);
        row.cgst += toPaise(it.cgst_amount);
        row.sgst += toPaise(it.sgst_amount);
        row.igst += toPaise(it.igst_amount);
        hsn.set(key, row);
        taxable += toPaise(it.taxable_amount);
        cgst += toPaise(it.cgst_amount);
        sgst += toPaise(it.sgst_amount);
        igst += toPaise(it.igst_amount);
    }

    const grandTotal = Number(invoice.grand_total);
    const paid = Number(invoice.paid_amount || 0);
    const balance = Math.max(fromPaise(toPaise(grandTotal) - toPaise(paid)), 0);
    const receivable = invoice.type === 'SALES' || invoice.type === 'DEBIT_NOTE';

    return {
        company,
        invoice,
        party: {
            name: invoice.party_name,
            gstin: invoice.party_gstin,
            state: invoice.party_state,
            address: invoice.party_address,
            phone: invoice.party_phone,
            email: invoice.party_email,
        },
        items,
        hsnSummary: [...hsn.values()].map((h) => ({
            ...h,
            taxable: fromPaise(h.taxable),
            cgst: fromPaise(h.cgst),
            sgst: fromPaise(h.sgst),
            igst: fromPaise(h.igst),
        })),
        totals: {
            taxable: fromPaise(taxable),
            cgst: fromPaise(cgst),
            sgst: fromPaise(sgst),
            igst: fromPaise(igst),
            roundOff: Number(invoice.round_off || 0),
            grandTotal,
            paid,
            balance,
        },
        title: DOC_TITLES[invoice.type] || 'Invoice',
        amountInWords: amountInWords(grandTotal),
        isInterState: igst > 0,
        upiLink: receivable ? upiLink(company, balance, `${DOC_SHORT[invoice.type]} ${invoice.invoice_number}`) : null,
    };
};

/* ---------------- Share messages ---------------- */

export const DEFAULT_SHARE_TEMPLATE =
    'Dear {party},\n\nPlease find {doc} {number} dated {date} for {amount}.\n{due}\nView / download: {link}\n{upi}\nThank you,\n{company}';

const formatDateIN = (d?: string | null) => {
    if (!d) return '';
    const [y, m, day] = String(d).slice(0, 10).split('-');
    return `${day}-${m}-${y}`;
};

/** Fills the company's message template (or the default) for WhatsApp / SMS / email bodies. */
export const buildShareMessage = (doc: InvoiceDocument, link: string): string => {
    const tpl = doc.company.share_message_template || DEFAULT_SHARE_TEMPLATE;
    const inv = doc.invoice;
    const values: Record<string, string> = {
        party: doc.party.name || 'Sir/Madam',
        doc: DOC_SHORT[inv.type]?.toLowerCase() || 'invoice',
        number: inv.invoice_number,
        date: formatDateIN(inv.date),
        amount: formatINR(doc.totals.grandTotal),
        balance: formatINR(doc.totals.balance),
        due:
            inv.due_date && doc.totals.balance > 0
                ? `Amount due ${formatINR(doc.totals.balance)} by ${formatDateIN(inv.due_date)}.`
                : '',
        link,
        upi: doc.company.upi_id && doc.totals.balance > 0 ? `Pay by UPI: ${doc.company.upi_id}` : '',
        company: doc.company.name,
    };
    return tpl
        .replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m))
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

/** Indian mobile numbers to WhatsApp format: digits only, country code 91 added for 10-digit numbers. */
export const whatsappNumber = (phone?: string | null): string | null => {
    if (!phone) return null;
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
    if (digits.length === 10) digits = `91${digits}`;
    return digits.length >= 11 && digits.length <= 15 ? digits : null;
};

export const whatsappUrl = (phone: string | null | undefined, message: string) => {
    const n = whatsappNumber(phone);
    return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(message)}`;
};
