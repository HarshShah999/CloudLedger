import path from 'path';
import PDFDocument from 'pdfkit';
import { CompanyProfile } from '../documentService';

const FONT_DIR = path.resolve(__dirname, '../../../assets/fonts');

export const PAGE = { width: 595.28, height: 841.89, margin: 36 };
export const CONTENT_W = PAGE.width - PAGE.margin * 2;
export const COLORS = { text: '#111827', muted: '#6B7280', line: '#D1D5DB', head: '#F3F4F6', accent: '#4338CA' };

/** A4 document with a Unicode font (DejaVu Sans has the ₹ sign). */
export const createDoc = (title: string) => {
    const doc = new PDFDocument({
        size: 'A4',
        margin: PAGE.margin,
        bufferPages: true,
        info: { Title: title, Producer: 'Taalmel', Creator: 'Taalmel' },
    });
    doc.registerFont('R', path.join(FONT_DIR, 'DejaVuSans.ttf'));
    doc.registerFont('B', path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
    doc.font('R').fillColor(COLORS.text);
    return doc;
};

/** 1234567.5 -> "12,34,567.50" */
export const inr = (n: number | string) =>
    Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const dmy = (d?: string | null) => {
    if (!d) return '';
    const [y, m, day] = String(d).slice(0, 10).split('-');
    return `${day}-${m}-${y}`;
};

export const hline = (doc: PDFKit.PDFDocument, y: number, x1 = PAGE.margin, x2 = PAGE.width - PAGE.margin) =>
    doc.moveTo(x1, y).lineTo(x2, y).lineWidth(0.6).strokeColor(COLORS.line).stroke();

/** Draws an image, ignoring corrupt files instead of failing the whole PDF. */
export const safeImage = (doc: PDFKit.PDFDocument, img: Buffer | null | undefined, x: number, y: number, opts: PDFKit.Mixins.ImageOption) => {
    if (!img) return false;
    try {
        doc.image(img, x, y, opts);
        return true;
    } catch {
        return false;
    }
};

/**
 * Company letterhead (logo + details) on the left, document title and optional
 * copy label ("ORIGINAL FOR RECIPIENT") on the right. Returns the y below it.
 */
export const letterhead = (doc: PDFKit.PDFDocument, c: CompanyProfile, title: string, copyLabel?: string) => {
    const accent = /^#[0-9a-f]{6}$/i.test(c.brand_color || '') ? c.brand_color : COLORS.accent;
    let x = PAGE.margin;
    const top = PAGE.margin;
    if (safeImage(doc, c.logo, x, top, { fit: [64, 64] })) x += 74;
    const textW = CONTENT_W * 0.62 - (x - PAGE.margin);

    doc.font('B').fontSize(16).fillColor(COLORS.text).text(c.name, x, top, { width: textW });
    let y = doc.y + 2;
    doc.font('R').fontSize(8.5).fillColor(COLORS.muted);
    const lines = [
        c.address,
        [c.state && `State: ${c.state}`, c.gstin && `GSTIN: ${c.gstin}`, c.pan && `PAN: ${c.pan}`].filter(Boolean).join('   '),
        [c.phone && `Ph: ${c.phone}`, c.email, c.website].filter(Boolean).join('   '),
    ].filter(Boolean) as string[];
    for (const l of lines) {
        doc.text(l, x, y, { width: textW });
        y = doc.y + 1;
    }
    doc.font('B').fontSize(14).fillColor(accent).text(title.toUpperCase(), PAGE.margin, top, { width: CONTENT_W, align: 'right' });
    if (copyLabel) {
        doc.font('R').fontSize(7.5).fillColor(COLORS.muted).text(copyLabel.toUpperCase(), PAGE.margin, doc.y + 1, { width: CONTENT_W, align: 'right' });
    }
    doc.fillColor(COLORS.text);
    y = Math.max(y, top + (c.logo ? 66 : 40)) + 6;
    doc.moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).lineWidth(1.2).strokeColor(accent).stroke();
    return y + 8;
};

/** Page x/y footer on every page. Call after all content is written. */
export const footer = (doc: PDFKit.PDFDocument, note: string) => {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        // Writing below the bottom margin would make PDFKit start a new page
        const bottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const y = PAGE.height - PAGE.margin + 8;
        doc.font('R').fontSize(7).fillColor(COLORS.muted);
        doc.text(note, PAGE.margin, y, { width: CONTENT_W / 2, lineBreak: false });
        doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE.margin, y, { width: CONTENT_W, align: 'right', lineBreak: false });
        doc.page.margins.bottom = bottom;
    }
    doc.fillColor(COLORS.text);
};

export interface Column {
    key: string;
    label: string;
    width: number; // fraction of content width
    align?: 'left' | 'right' | 'center';
}

/**
 * Draws a table with a shaded header, repeating the header on new pages.
 * Returns the y after the last row.
 */
export const table = (
    doc: PDFKit.PDFDocument,
    startY: number,
    columns: Column[],
    rows: Record<string, string>[],
    opts: { fontSize?: number; bottomReserve?: number; boldLastRow?: boolean } = {}
) => {
    const fontSize = opts.fontSize ?? 8;
    const pad = 3;
    const xs: number[] = [];
    let acc = PAGE.margin;
    for (const c of columns) {
        xs.push(acc);
        acc += c.width * CONTENT_W;
    }

    const drawHeader = (y: number) => {
        doc.rect(PAGE.margin, y, CONTENT_W, fontSize + 8).fill(COLORS.head);
        doc.fillColor(COLORS.text).font('B').fontSize(fontSize);
        columns.forEach((c, i) =>
            doc.text(c.label, xs[i] + pad, y + 4, { width: c.width * CONTENT_W - pad * 2, align: c.align ?? 'left', lineBreak: false })
        );
        return y + fontSize + 10;
    };

    let y = drawHeader(startY);
    const limit = PAGE.height - PAGE.margin - (opts.bottomReserve ?? 30);
    rows.forEach((row, idx) => {
        const bold = opts.boldLastRow && idx === rows.length - 1;
        doc.font(bold ? 'B' : 'R').fontSize(fontSize);
        const h = Math.max(
            ...columns.map((c) => doc.heightOfString(row[c.key] ?? '', { width: c.width * CONTENT_W - pad * 2 }))
        );
        if (y + h + 6 > limit) {
            doc.addPage();
            y = drawHeader(PAGE.margin);
            doc.font(bold ? 'B' : 'R').fontSize(fontSize);
        }
        columns.forEach((c, i) =>
            doc.fillColor(COLORS.text).text(row[c.key] ?? '', xs[i] + pad, y + 2, { width: c.width * CONTENT_W - pad * 2, align: c.align ?? 'left' })
        );
        y += h + 5;
        hline(doc, y);
        y += 1;
    });
    return y;
};

/** Moves to a new page if fewer than `needed` points remain. Returns the y to use. */
export const ensureSpace = (doc: PDFKit.PDFDocument, y: number, needed: number) => {
    if (y + needed > PAGE.height - PAGE.margin - 20) {
        doc.addPage();
        return PAGE.margin;
    }
    return y;
};
