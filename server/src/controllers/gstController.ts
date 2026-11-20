import { Request, Response } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { isInterStateSupply } from '../services/invoiceCalc';

/** B2C (Large): unregistered, inter-state, invoice value above ₹1,00,000 (limit since 1 Aug 2024). */
const B2CL_LIMIT = 100000;

const period = (req: Request) => {
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) throw new AppError('From date and To date are required', 400);
    return [String(fromDate).slice(0, 10), String(toDate).slice(0, 10)];
};

export const getGSTR1 = async (req: Request, res: Response) => {
    const [from, to] = period(req);
    const result = await query(
        `SELECT i.id, i.invoice_number, i.date, i.type, i.grand_total, i.tax_total, i.subtotal,
                i.original_invoice_number, i.original_invoice_date,
                COALESCE(i.place_of_supply, l.state) AS place_of_supply,
                l.name AS party_name, l.gstin AS party_gstin, l.state AS party_state, c.state AS company_state,
                (SELECT json_agg(json_build_object(
                    'taxable_amount', ii.taxable_amount, 'tax_rate', ii.tax_rate,
                    'cgst_amount', ii.cgst_amount, 'sgst_amount', ii.sgst_amount, 'igst_amount', ii.igst_amount))
                 FROM invoice_items ii WHERE ii.invoice_id = i.id) AS items
         FROM invoices i
         LEFT JOIN ledgers l ON i.party_ledger_id = l.id
         LEFT JOIN companies c ON i.company_id = c.id
         WHERE i.company_id = $1 AND i.type IN ('SALES', 'CREDIT_NOTE', 'DEBIT_NOTE')
           AND i.date BETWEEN $2 AND $3
         ORDER BY i.date, i.invoice_number`,
        [req.company!.id, from, to]
    );

    const b2b: any[] = [];
    const b2cLarge: any[] = [];
    const b2cSmall: any[] = [];
    const cdnr: any[] = [];
    const cdnur: any[] = [];

    for (const inv of result.rows) {
        const registered = !!inv.party_gstin;
        const inter = isInterStateSupply(inv.company_state, inv.place_of_supply);
        if (inv.type !== 'SALES') {
            (registered ? cdnr : cdnur).push(inv);
        } else if (registered) {
            b2b.push(inv);
        } else if (inter && Number(inv.grand_total) > B2CL_LIMIT) {
            b2cLarge.push(inv);
        } else {
            b2cSmall.push(inv);
        }
    }
    res.status(200).json({ status: 'success', data: { b2b, b2cLarge, b2cSmall, cdnr, cdnur } });
};

const taxSums = async (companyId: string, from: string, to: string, plus: string, minus: string) => {
    const r = await query(
        `SELECT
            COALESCE(SUM(ii.taxable_amount * CASE WHEN i.type = $4 THEN 1 ELSE -1 END), 0) AS taxable_value,
            COALESCE(SUM(ii.igst_amount * CASE WHEN i.type = $4 THEN 1 ELSE -1 END), 0) AS igst,
            COALESCE(SUM(ii.cgst_amount * CASE WHEN i.type = $4 THEN 1 ELSE -1 END), 0) AS cgst,
            COALESCE(SUM(ii.sgst_amount * CASE WHEN i.type = $4 THEN 1 ELSE -1 END), 0) AS sgst
         FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
         WHERE i.company_id = $1 AND i.date BETWEEN $2 AND $3 AND i.type IN ($4, $5)`,
        [companyId, from, to, plus, minus]
    );
    const row = r.rows[0];
    return {
        taxable_value: Number(row.taxable_value),
        igst: Number(row.igst),
        cgst: Number(row.cgst),
        sgst: Number(row.sgst),
    };
};

/** Summary for GSTR-3B: outward tax (sales − credit notes) and ITC (purchases − debit notes). */
export const getGSTR3B = async (req: Request, res: Response) => {
    const [from, to] = period(req);
    const outward = await taxSums(req.company!.id, from, to, 'SALES', 'CREDIT_NOTE');
    const itc = await taxSums(req.company!.id, from, to, 'PURCHASE', 'DEBIT_NOTE');
    const net = {
        igst: outward.igst - itc.igst,
        cgst: outward.cgst - itc.cgst,
        sgst: outward.sgst - itc.sgst,
    };
    res.status(200).json({ status: 'success', data: { outward_supplies: outward, eligible_itc: itc, net_payable: net } });
};
