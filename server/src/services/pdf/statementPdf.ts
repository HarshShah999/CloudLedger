import { CompanyProfile } from '../documentService';
import { pdfToBuffer } from '../../utils/pdfBuffer';
import { COLORS, CONTENT_W, PAGE, createDoc, dmy, footer, inr, letterhead, table } from './base';

export interface StatementData {
    ledger: {
        name: string;
        group_name: string | null;
        opening_balance: number;
        opening_balance_type: string;
        total_debit: number;
        total_credit: number;
        closing_balance: number;
        closing_balance_type: string;
    };
    period: { from: string; to: string };
    transactions: any[];
    party?: { gstin?: string | null; address?: string | null; phone?: string | null };
}

export const renderStatementPdf = async (company: CompanyProfile, s: StatementData): Promise<Buffer> => {
    const doc = createDoc(`Statement of Account - ${s.ledger.name}`);
    let y = letterhead(doc, company, 'Statement of Account');
    const x = PAGE.margin;

    doc.font('B').fontSize(11).fillColor(COLORS.text).text(s.ledger.name, x, y, { width: CONTENT_W * 0.6 });
    doc.font('R').fontSize(8.5).fillColor(COLORS.muted);
    for (const l of [s.party?.address, s.party?.gstin && `GSTIN: ${s.party.gstin}`, s.party?.phone && `Ph: ${s.party.phone}`]) {
        if (l) doc.text(l, x, doc.y + 1, { width: CONTENT_W * 0.6 });
    }
    doc.font('B').fontSize(9).fillColor(COLORS.text).text(`${dmy(s.period.from)} to ${dmy(s.period.to)}`, x, y, { width: CONTENT_W, align: 'right' });
    y = doc.y + 30;

    const rows: Record<string, string>[] = [
        {
            date: dmy(s.period.from),
            particulars: 'Opening Balance',
            vch: '',
            debit: s.ledger.opening_balance_type === 'Dr' && s.ledger.opening_balance ? inr(s.ledger.opening_balance) : '',
            credit: s.ledger.opening_balance_type === 'Cr' && s.ledger.opening_balance ? inr(s.ledger.opening_balance) : '',
            balance: `${inr(s.ledger.opening_balance)} ${s.ledger.opening_balance_type}`,
        },
        ...s.transactions.map((t) => ({
            date: dmy(t.date),
            particulars: [t.particulars, t.narration].filter(Boolean).join('\n'),
            vch: `${t.voucher_type_name || ''}\n${t.voucher_number || ''}`,
            debit: t.debit ? inr(t.debit) : '',
            credit: t.credit ? inr(t.credit) : '',
            balance: `${inr(t.balance)} ${t.balance_type}`,
        })),
        {
            date: '',
            particulars: 'Closing Balance',
            vch: '',
            debit: inr(s.ledger.total_debit),
            credit: inr(s.ledger.total_credit),
            balance: `${inr(s.ledger.closing_balance)} ${s.ledger.closing_balance_type}`,
        },
    ];

    table(
        doc,
        y,
        [
            { key: 'date', label: 'Date', width: 0.11 },
            { key: 'particulars', label: 'Particulars', width: 0.33 },
            { key: 'vch', label: 'Voucher', width: 0.14 },
            { key: 'debit', label: 'Debit', width: 0.13, align: 'right' },
            { key: 'credit', label: 'Credit', width: 0.13, align: 'right' },
            { key: 'balance', label: 'Balance', width: 0.16, align: 'right' },
        ],
        rows,
        { boldLastRow: true }
    );

    footer(doc, 'This is a computer-generated statement.');
    return pdfToBuffer(doc);
};
