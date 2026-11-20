import path from 'path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { InvoiceDocument } from '../documentService';
import { pdfToBuffer } from '../../utils/pdfBuffer';
import { dmy, inr, safeImage } from './base';

const FONT_DIR = path.resolve(__dirname, '../../../assets/fonts');
const WIDTH = 226.77; // 80 mm roll
const M = 8;
const W = WIDTH - M * 2;

/**
 * Compact receipt for 80 mm thermal printers (counter billing in shops).
 * The page height is computed from the content so there is no blank paper.
 */
export const renderThermalPdf = async (d: InvoiceDocument): Promise<Buffer> => {
    const qr = d.upiLink ? await QRCode.toBuffer(d.upiLink, { margin: 0, width: 200 }) : null;

    const draw = (doc: PDFKit.PDFDocument) => {
        let y = M;
        const c = d.company;
        const inv = d.invoice;
        const center = (text: string, size = 7.5, bold = false) => {
            doc.font(bold ? 'B' : 'R').fontSize(size).text(text, M, y, { width: W, align: 'center' });
            y = doc.y + 1;
        };
        const lr = (l: string, r: string, bold = false, size = 7.5) => {
            doc.font(bold ? 'B' : 'R').fontSize(size);
            const h = doc.heightOfString(l, { width: W * 0.62 });
            doc.text(l, M, y, { width: W * 0.62 });
            doc.text(r, M + W * 0.62, y, { width: W * 0.38, align: 'right' });
            y += h + 1;
        };
        const rule = () => {
            doc.moveTo(M, y + 1).lineTo(WIDTH - M, y + 1).dash(1.5, { space: 1.5 }).lineWidth(0.5).strokeColor('#000').stroke().undash();
            y += 4;
        };

        if (safeImage(doc, c.logo, (WIDTH - 48) / 2, y, { fit: [48, 48] })) y += 52;
        center(c.name, 10, true);
        if (c.address) center(c.address, 7);
        if (c.phone) center(`Ph: ${c.phone}`, 7);
        if (c.gstin) center(`GSTIN: ${c.gstin}`, 7);
        rule();
        center(d.title.toUpperCase(), 8.5, true);
        lr(`No: ${inv.invoice_number}`, dmy(inv.date));
        if (d.party.name) lr(`To: ${d.party.name}`, '');
        if (d.party.gstin) lr(`GSTIN: ${d.party.gstin}`, '');
        rule();

        for (const it of d.items) {
            doc.font('R').fontSize(7.5).text(it.item_name || it.description || '', M, y, { width: W });
            y = doc.y;
            lr(
                `  ${Number(it.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 })} × ${inr(it.rate)}${Number(it.tax_rate) ? ` (+${Number(it.tax_rate)}%)` : ''}`,
                inr(it.total_amount)
            );
        }
        rule();
        lr('Taxable', inr(d.totals.taxable));
        if (d.totals.cgst) lr('CGST', inr(d.totals.cgst));
        if (d.totals.sgst) lr('SGST', inr(d.totals.sgst));
        if (d.totals.igst) lr('IGST', inr(d.totals.igst));
        if (d.totals.roundOff) lr('Round off', inr(d.totals.roundOff));
        lr('TOTAL', `₹${inr(d.totals.grandTotal)}`, true, 10);
        if (d.totals.paid > 0) {
            lr('Paid', inr(d.totals.paid));
            lr('Balance', `₹${inr(d.totals.balance)}`, true);
        }
        rule();
        if (qr) {
            doc.image(qr, (WIDTH - 90) / 2, y, { width: 90 });
            y += 92;
            center(`Scan to pay ₹${inr(d.totals.balance)} via UPI`, 7);
        }
        center('Thank you! Visit again.', 7.5, true);
        return y + M;
    };

    const make = (height: number) => {
        const doc = new PDFDocument({ size: [WIDTH, height], margin: 0, info: { Title: `${d.title} ${d.invoice.invoice_number}`, Producer: 'CloudLedger' } });
        doc.registerFont('R', path.join(FONT_DIR, 'DejaVuSans.ttf'));
        doc.registerFont('B', path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
        doc.fillColor('#000');
        return doc;
    };

    // First pass measures the height, second pass renders on a page that fits exactly.
    const probe = make(5000);
    const height = draw(probe);
    probe.end();
    const doc = make(Math.ceil(height));
    draw(doc);
    return pdfToBuffer(doc);
};
