import PDFDocument from 'pdfkit';
import { query } from '../config/db';

interface InvoiceData {
    invoice: any;
    items: any[];
    company: any;
}

const numberToWords = (num: number): string => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    if (num === 0) return 'Zero';

    const convert = (n: number): string => {
        if (n < 10) return ones[n];
        if (n < 20) return teens[n - 10];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '');
        if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + convert(n % 100) : '');
        if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + convert(n % 1000) : '');
        if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + convert(n % 100000) : '');
        return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + convert(n % 10000000) : '');
    };

    const rupees = Math.floor(num);
    const paise = Math.round((num - rupees) * 100);

    let result = convert(rupees) + ' Rupees';
    if (paise > 0) {
        result += ' and ' + convert(paise) + ' Paise';
    }
    return result + ' Only';
};

export const generateInvoicePDF = async (invoiceId: string): Promise<PDFKit.PDFDocument> => {
    // Fetch invoice data
    const invoiceRes = await query(
        `SELECT i.*, l.name as party_name, l.gstin as party_gstin, l.state as party_state,
                sl.name as sales_ledger_name, c.name as company_name, c.gstin as company_gstin, 
                c.state as company_state, c.address as company_address, c.email as company_email, c.phone as company_phone
         FROM invoices i 
         LEFT JOIN ledgers l ON i.party_ledger_id = l.id 
         LEFT JOIN ledgers sl ON i.sales_ledger_id = sl.id
         LEFT JOIN companies c ON i.company_id = c.id
         WHERE i.id = $1`,
        [invoiceId]
    );

    if (invoiceRes.rows.length === 0) {
        throw new Error('Invoice not found');
    }

    const invoice = invoiceRes.rows[0];

    const itemsRes = await query(
        `SELECT ii.*, it.name as item_name, it.hsn_code, u.symbol as unit_symbol 
         FROM invoice_items ii 
         LEFT JOIN items it ON ii.item_id = it.id 
         LEFT JOIN units u ON it.unit_id = u.id
         WHERE ii.invoice_id = $1`,
        [invoiceId]
    );

    const items = itemsRes.rows;

    // Create PDF
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text(invoice.company_name || 'Company Name', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(invoice.company_address || '', { align: 'center' });
    doc.text(`Email: ${invoice.company_email || ''} | Phone: ${invoice.company_phone || ''}`, { align: 'center' });
    if (invoice.company_gstin) {
        doc.text(`GSTIN: ${invoice.company_gstin}`, { align: 'center' });
    }

    doc.moveDown();
    doc.fontSize(16).font('Helvetica-Bold').text(
        invoice.type === 'SALES' ? 'TAX INVOICE' : 'PURCHASE INVOICE',
        { align: 'center' }
    );

    doc.moveDown();

    // Invoice Details
    const startY = doc.y;
    doc.fontSize(10).font('Helvetica');
    doc.text(`Invoice No: ${invoice.invoice_number}`, 50, startY);
    doc.text(`Date: ${new Date(invoice.date).toLocaleDateString()}`, 50, startY + 15);
    if (invoice.due_date) {
        doc.text(`Due Date: ${new Date(invoice.due_date).toLocaleDateString()}`, 50, startY + 30);
    }

    // Party Details
    doc.text(`Bill To:`, 350, startY);
    doc.font('Helvetica-Bold').text(invoice.party_name || '', 350, startY + 15);
    doc.font('Helvetica');
    if (invoice.party_gstin) {
        doc.text(`GSTIN: ${invoice.party_gstin}`, 350, startY + 30);
    }
    if (invoice.party_state) {
        doc.text(`State: ${invoice.party_state}`, 350, startY + 45);
    }

    doc.moveDown(4);

    // Table Header
    const tableTop = doc.y;
    const itemX = 50;
    const hsnX = 200;
    const qtyX = 270;
    const rateX = 320;
    const amountX = 380;
    const taxX = 450;
    const totalX = 510;

    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Item', itemX, tableTop);
    doc.text('HSN', hsnX, tableTop);
    doc.text('Qty', qtyX, tableTop);
    doc.text('Rate', rateX, tableTop);
    doc.text('Amount', amountX, tableTop);
    doc.text('Tax', taxX, tableTop);
    doc.text('Total', totalX, tableTop);

    doc.moveTo(50, tableTop + 15).lineTo(560, tableTop + 15).stroke();

    // Table Rows
    let currentY = tableTop + 25;
    doc.font('Helvetica').fontSize(8);

    for (const item of items) {
        if (currentY > 700) {
            doc.addPage();
            currentY = 50;
        }

        doc.text(item.item_name || item.description || '', itemX, currentY, { width: 140 });
        doc.text(item.hsn_code || '', hsnX, currentY);
        doc.text(`${Number(item.quantity).toFixed(2)} ${item.unit_symbol || ''}`, qtyX, currentY);
        doc.text(Number(item.rate).toFixed(2), rateX, currentY);
        doc.text(Number(item.taxable_amount).toFixed(2), amountX, currentY);

        // Tax breakdown
        let taxText = '';
        if (Number(item.igst_amount) > 0) {
            taxText = `IGST ${Number(item.igst_rate)}%: ${Number(item.igst_amount).toFixed(2)}`;
        } else {
            if (Number(item.cgst_amount) > 0) {
                taxText = `CGST ${Number(item.cgst_rate)}%: ${Number(item.cgst_amount).toFixed(2)}\n`;
                taxText += `SGST ${Number(item.sgst_rate)}%: ${Number(item.sgst_amount).toFixed(2)}`;
            }
        }
        doc.text(taxText, taxX, currentY, { width: 50 });
        doc.text(Number(item.total_amount).toFixed(2), totalX, currentY);

        currentY += 30;
    }

    doc.moveTo(50, currentY).lineTo(560, currentY).stroke();

    // Totals
    currentY += 10;
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Subtotal:', 400, currentY);
    doc.text(Number(invoice.subtotal).toFixed(2), totalX, currentY);

    currentY += 15;
    doc.text('Tax Total:', 400, currentY);
    doc.text(Number(invoice.tax_total).toFixed(2), totalX, currentY);

    if (Number(invoice.discount_amount) > 0) {
        currentY += 15;
        doc.text(`Discount (${Number(invoice.discount_percent)}%):`, 400, currentY);
        doc.text(`-${Number(invoice.discount_amount).toFixed(2)}`, totalX, currentY);
    }

    currentY += 15;
    doc.fontSize(11).text('Grand Total:', 400, currentY);
    doc.text(`₹${Number(invoice.grand_total).toFixed(2)}`, totalX, currentY);

    // Amount in words
    currentY += 25;
    doc.fontSize(9).font('Helvetica');
    doc.text(`Amount in Words: ${numberToWords(Number(invoice.grand_total))}`, 50, currentY, { width: 500 });

    // Footer
    currentY += 40;
    doc.fontSize(8);
    doc.text('Terms & Conditions:', 50, currentY);
    currentY += 12;
    doc.text('1. Payment is due within the specified due date.', 50, currentY);
    currentY += 12;
    doc.text('2. Please quote invoice number when remitting funds.', 50, currentY);

    // Signature
    doc.text('For ' + (invoice.company_name || 'Company Name'), 400, currentY + 40);
    doc.text('Authorized Signatory', 400, currentY + 80);

    return doc;
};
