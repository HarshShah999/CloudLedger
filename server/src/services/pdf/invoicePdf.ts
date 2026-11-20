import QRCode from 'qrcode';
import { InvoiceDocument, DOC_SHORT } from '../documentService';
import { pdfToBuffer } from '../../utils/pdfBuffer';
import { COLORS, CONTENT_W, PAGE, createDoc, dmy, ensureSpace, footer, hline, inr, letterhead, table } from './base';

const DEFAULT_TERMS = [
    'Goods once sold will not be taken back.',
    'Interest @18% p.a. may be charged on payments received after the due date.',
    'Subject to local jurisdiction.',
];

/** Renders a GST invoice / bill / credit note / debit note as a PDF buffer. */
export const renderInvoicePdf = async (d: InvoiceDocument): Promise<Buffer> => {
    const inv = d.invoice;
    const doc = createDoc(`${d.title} ${inv.invoice_number}`);
    const x = PAGE.margin;
    let y = letterhead(doc, d.company, d.title);

    // ---- Bill-to and document details ----
    const leftW = CONTENT_W * 0.55;
    const rightX = x + leftW + 10;
    const rightW = CONTENT_W - leftW - 10;
    const top = y;

    const partyLabel = inv.type === 'PURCHASE' || inv.type === 'DEBIT_NOTE' ? 'Supplier' : 'Bill To';
    doc.font('B').fontSize(8).fillColor(COLORS.muted).text(partyLabel.toUpperCase(), x, y);
    doc.font('B').fontSize(10.5).fillColor(COLORS.text).text(d.party.name || '', x, doc.y + 2, { width: leftW });
    doc.font('R').fontSize(8.5);
    const partyLines = [
        d.party.address,
        d.party.state && `State: ${d.party.state}`,
        d.party.gstin ? `GSTIN: ${d.party.gstin}` : 'Unregistered',
        d.party.phone && `Ph: ${d.party.phone}`,
    ].filter(Boolean) as string[];
    for (const l of partyLines) doc.text(l, x, doc.y + 1, { width: leftW });
    const leftBottom = doc.y;

    const meta: [string, string][] = [
        [`${DOC_SHORT[inv.type] || 'Invoice'} No.`, inv.invoice_number],
        ['Date', dmy(inv.date)],
    ];
    if (inv.due_date) meta.push(['Due Date', dmy(inv.due_date)]);
    if (inv.place_of_supply) meta.push(['Place of Supply', inv.place_of_supply]);
    if (inv.type === 'SALES') meta.push(['Reverse Charge', 'No']);
    if (inv.original_invoice_number) {
        meta.push(['Against Invoice', `${inv.original_invoice_number}${inv.original_invoice_date ? ` dt. ${dmy(inv.original_invoice_date)}` : ''}`]);
    }
    let my = top;
    for (const [k, v] of meta) {
        doc.font('R').fontSize(8.5).fillColor(COLORS.muted).text(k, rightX, my, { width: rightW * 0.45 });
        doc.font('B').fillColor(COLORS.text).text(v, rightX + rightW * 0.45, my, { width: rightW * 0.55, align: 'right' });
        my = doc.y + 2;
    }
    y = Math.max(leftBottom, my) + 8;
    hline(doc, y);
    y += 6;

    // ---- Items ----
    const inter = d.isInterState;
    const cols = [
        { key: 'sn', label: '#', width: 0.04 },
        { key: 'desc', label: 'Item / Description', width: inter ? 0.3 : 0.27 },
        { key: 'hsn', label: 'HSN/SAC', width: 0.09 },
        { key: 'qty', label: 'Qty', width: 0.09, align: 'right' as const },
        { key: 'rate', label: 'Rate', width: 0.1, align: 'right' as const },
        { key: 'disc', label: 'Disc.', width: 0.08, align: 'right' as const },
        { key: 'taxable', label: 'Taxable', width: 0.11, align: 'right' as const },
        { key: 'gst', label: inter ? 'IGST' : 'GST', width: inter ? 0.08 : 0.11, align: 'right' as const },
        { key: 'total', label: 'Amount', width: 0.11, align: 'right' as const },
    ];
    const rows = d.items.map((it, i) => {
        const name = it.item_name || it.description || '';
        const desc = it.item_name && it.description && it.description !== it.item_name ? `${name}\n${it.description}` : name;
        const tax = Number(it.cgst_amount) + Number(it.sgst_amount) + Number(it.igst_amount);
        return {
            sn: String(i + 1),
            desc,
            hsn: it.hsn_code || '',
            qty: `${Number(it.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 })}${it.unit_symbol ? ` ${it.unit_symbol}` : ''}`,
            rate: inr(it.rate),
            disc: Number(it.discount_amount) ? inr(it.discount_amount) : '',
            taxable: inr(it.taxable_amount),
            gst: tax ? `${inr(tax)}\n@${Number(it.tax_rate)}%` : '-',
            total: inr(it.total_amount),
        };
    });
    y = table(doc, y, cols, rows, { bottomReserve: 40 });

    // ---- Totals ----
    y = ensureSpace(doc, y + 6, 140);
    const tx = x + CONTENT_W * 0.55;
    const tw = CONTENT_W * 0.45;
    const line = (label: string, value: string, bold = false) => {
        doc.font(bold ? 'B' : 'R').fontSize(bold ? 10.5 : 8.5).fillColor(COLORS.text);
        doc.text(label, tx, y, { width: tw * 0.6 });
        doc.text(value, tx + tw * 0.6, y, { width: tw * 0.4, align: 'right' });
        y = doc.y + 3;
    };
    const totalsTop = y;
    if (Number(inv.discount_amount) > 0) line(`Invoice discount (${Number(inv.discount_percent)}%)`, `-${inr(inv.discount_amount)}`);
    line('Taxable value', inr(d.totals.taxable));
    if (d.totals.cgst) line('CGST', inr(d.totals.cgst));
    if (d.totals.sgst) line('SGST', inr(d.totals.sgst));
    if (d.totals.igst) line('IGST', inr(d.totals.igst));
    if (d.totals.roundOff) line('Round off', `${d.totals.roundOff > 0 ? '+' : ''}${inr(d.totals.roundOff)}`);
    hline(doc, y, tx);
    y += 4;
    line('Total', `₹ ${inr(d.totals.grandTotal)}`, true);
    if (d.totals.paid > 0) {
        line('Paid', inr(d.totals.paid));
        line('Balance due', `₹ ${inr(d.totals.balance)}`, true);
    }
    const totalsBottom = y;

    // Amount in words (left of totals)
    doc.font('B').fontSize(8).fillColor(COLORS.muted).text('AMOUNT IN WORDS', x, totalsTop, { width: CONTENT_W * 0.52 });
    doc.font('R').fontSize(8.5).fillColor(COLORS.text).text(d.amountInWords, x, doc.y + 2, { width: CONTENT_W * 0.52 });
    if (inv.notes) {
        doc.font('B').fontSize(8).fillColor(COLORS.muted).text('NOTES', x, doc.y + 6, { width: CONTENT_W * 0.52 });
        doc.font('R').fontSize(8.5).fillColor(COLORS.text).text(inv.notes, x, doc.y + 2, { width: CONTENT_W * 0.52 });
    }
    y = Math.max(y, doc.y, totalsBottom) + 10;

    // ---- HSN summary (only when tax is charged) ----
    if (d.totals.cgst + d.totals.sgst + d.totals.igst > 0) {
        y = ensureSpace(doc, y, 80);
        const hcols = inter
            ? [
                  { key: 'hsn', label: 'HSN/SAC', width: 0.3 },
                  { key: 'taxable', label: 'Taxable Value', width: 0.25, align: 'right' as const },
                  { key: 'rate', label: 'IGST Rate', width: 0.2, align: 'right' as const },
                  { key: 'igst', label: 'IGST', width: 0.25, align: 'right' as const },
              ]
            : [
                  { key: 'hsn', label: 'HSN/SAC', width: 0.22 },
                  { key: 'taxable', label: 'Taxable Value', width: 0.2, align: 'right' as const },
                  { key: 'rate', label: 'Rate', width: 0.12, align: 'right' as const },
                  { key: 'cgst', label: 'CGST', width: 0.15, align: 'right' as const },
                  { key: 'sgst', label: 'SGST', width: 0.15, align: 'right' as const },
                  { key: 'tax', label: 'Total Tax', width: 0.16, align: 'right' as const },
              ];
        const hrows = d.hsnSummary.map((h) => ({
            hsn: h.hsn,
            taxable: inr(h.taxable),
            rate: `${h.rate}%`,
            cgst: inr(h.cgst),
            sgst: inr(h.sgst),
            igst: inr(h.igst),
            tax: inr(h.cgst + h.sgst + h.igst),
        }));
        y = table(doc, y, hcols, hrows, { fontSize: 7.5 }) + 10;
    }

    // ---- Bank details, UPI QR, terms, signature ----
    y = ensureSpace(doc, y, 130);
    const blockTop = y;
    const c = d.company;
    let ly = y;
    const hasBank = c.bank_account_number || c.bank_name;
    if (hasBank) {
        doc.font('B').fontSize(8).fillColor(COLORS.muted).text('BANK DETAILS', x, ly);
        doc.font('R').fontSize(8.5).fillColor(COLORS.text);
        const bank = [
            c.bank_account_name && `A/c Name: ${c.bank_account_name}`,
            c.bank_name && `Bank: ${c.bank_name}${c.bank_branch ? `, ${c.bank_branch}` : ''}`,
            c.bank_account_number && `A/c No: ${c.bank_account_number}`,
            c.bank_ifsc && `IFSC: ${c.bank_ifsc}`,
            c.upi_id && `UPI: ${c.upi_id}`,
        ].filter(Boolean) as string[];
        for (const b of bank) doc.text(b, x, doc.y + 1, { width: CONTENT_W * 0.4 });
        ly = doc.y + 8;
    }

    const terms = (c.invoice_terms ? c.invoice_terms.split(/\r?\n/).filter((t) => t.trim()) : inv.type === 'SALES' ? DEFAULT_TERMS : []);
    if (terms.length) {
        doc.font('B').fontSize(8).fillColor(COLORS.muted).text('TERMS & CONDITIONS', x, ly);
        doc.font('R').fontSize(7.5).fillColor(COLORS.text);
        terms.forEach((t, i) => doc.text(`${i + 1}. ${t}`, x, doc.y + 1, { width: CONTENT_W * 0.42 }));
        ly = doc.y;
    }

    if (d.upiLink) {
        const png = await QRCode.toBuffer(d.upiLink, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
        const qx = x + CONTENT_W * 0.46;
        doc.image(png, qx, blockTop, { width: 84 });
        doc.font('B').fontSize(8).fillColor(COLORS.text).text('Scan to pay with UPI', qx - 10, blockTop + 88, { width: 104, align: 'center' });
        doc.font('R').fontSize(7.5).fillColor(COLORS.muted).text(`₹ ${inr(d.totals.balance)}`, qx - 10, doc.y + 1, { width: 104, align: 'center' });
        ly = Math.max(ly, doc.y);
    }

    const sx = x + CONTENT_W * 0.66;
    const sw = CONTENT_W * 0.34;
    doc.font('B').fontSize(8.5).fillColor(COLORS.text).text(`For ${c.name}`, sx, blockTop, { width: sw, align: 'right' });
    doc.font('R').fontSize(8).fillColor(COLORS.muted).text('Authorised Signatory', sx, blockTop + 70, { width: sw, align: 'right' });

    footer(doc, 'This is a computer-generated document.');
    return pdfToBuffer(doc);
};
