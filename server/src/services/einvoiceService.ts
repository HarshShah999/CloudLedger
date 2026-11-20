import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { fromPaise, toPaise } from '../utils/money';
import { stateCode, uqcFor } from '../utils/gst';

const dmySlash = (d: string) => {
    const [y, m, day] = String(d).slice(0, 10).split('-');
    return `${day}/${m}/${y}`;
};
const num = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;

const SUP_TYP: Record<string, string> = {
    NORMAL: 'B2B',
    SEZ_WPAY: 'SEZWP',
    SEZ_WOPAY: 'SEZWOP',
    EXPORT_WPAY: 'EXPWP',
    EXPORT_WOPAY: 'EXPWOP',
    DEEMED_EXPORT: 'DEXP',
};

/** Shared loader for e-invoice and e-way bill: invoice, seller, buyer and lines. */
export const loadForEDoc = async (invoiceId: string) => {
    const inv = (
        await query(
            `SELECT i.*, l.name AS party_name, l.gstin AS party_gstin, l.state AS party_state, l.address AS party_address,
                    l.city AS party_city, l.pincode AS party_pincode, l.phone AS party_phone, l.email AS party_email,
                    l.gst_registration_type AS party_reg
             FROM invoices i JOIN ledgers l ON l.id = i.party_ledger_id WHERE i.id = $1`,
            [invoiceId]
        )
    ).rows[0];
    if (!inv) throw new AppError('Invoice not found', 404);
    const company = (await query('SELECT * FROM companies WHERE id = $1', [inv.company_id])).rows[0];
    const items = (
        await query(
            `SELECT ii.*, it.name AS item_name, it.hsn_code, it.item_type, u.uqc, u.symbol AS unit_symbol
             FROM invoice_items ii LEFT JOIN items it ON it.id = ii.item_id LEFT JOIN units u ON u.id = it.unit_id
             WHERE ii.invoice_id = $1 ORDER BY ii.created_at, ii.id`,
            [invoiceId]
        )
    ).rows;
    return { inv, company, items };
};

/** Which documents need an e-invoice: B2B/SEZ/export sales and credit notes. */
export const einvoiceApplicable = (inv: { type: string; party_gstin: string | null; supply_type: string }) =>
    (inv.type === 'SALES' || inv.type === 'CREDIT_NOTE') && (!!inv.party_gstin || inv.supply_type !== 'NORMAL');

/**
 * E-invoice JSON in the NIC IRP schema (INV-01, version 1.1) for one invoice.
 * Returns the payload and a list of problems that would make the IRP reject it.
 */
export const buildEinvoice = async (invoiceId: string) => {
    const { inv, company, items } = await loadForEDoc(invoiceId);
    const problems: string[] = [];
    if (!einvoiceApplicable(inv)) problems.push('E-invoice applies only to sales/credit notes to registered buyers, SEZ and exports');
    if (!company.gstin) problems.push('Company GSTIN is missing (Settings)');
    if (!company.address) problems.push('Company address is missing (Settings)');
    if (!company.city) problems.push('Company city is missing (Settings)');
    if (!/^[1-9]\d{5}$/.test(company.pincode || '')) problems.push('Company PIN code is missing or invalid (Settings)');

    const isExport = String(inv.supply_type).startsWith('EXPORT');
    const buyerState = isExport ? '96' : stateCode(inv.party_state);
    const pos = isExport ? '96' : stateCode(inv.place_of_supply) || buyerState;
    if (!isExport) {
        if (!inv.party_gstin) problems.push(`${inv.party_name}: GSTIN is missing`);
        if (!inv.party_address) problems.push(`${inv.party_name}: address is missing`);
        if (!inv.party_city) problems.push(`${inv.party_name}: city is missing`);
        if (!/^[1-9]\d{5}$/.test(inv.party_pincode || '')) problems.push(`${inv.party_name}: PIN code is missing or invalid`);
    }
    if (!pos) problems.push('Place of supply is missing');

    const itemList = items.map((it, idx) => {
        const hsn = String(it.hsn_code || '').replace(/\s/g, '');
        if (!/^\d{4,8}$/.test(hsn)) problems.push(`Line ${idx + 1} (${it.item_name || it.description}): HSN/SAC must be 4–8 digits`);
        const isService = it.item_type === 'SERVICES' || hsn.startsWith('99');
        return {
            SlNo: String(idx + 1),
            PrdDesc: String(it.item_name || it.description || 'Item').slice(0, 300),
            IsServc: isService ? 'Y' : 'N',
            HsnCd: hsn,
            Qty: Number(it.quantity),
            Unit: isService ? 'OTH' : uqcFor(it.uqc, it.unit_symbol),
            UnitPrice: num(it.rate),
            TotAmt: num(it.amount),
            Discount: num(it.discount_amount),
            AssAmt: num(it.taxable_amount),
            GstRt: Number(it.tax_rate),
            IgstAmt: num(it.igst_amount),
            CgstAmt: num(it.cgst_amount),
            SgstAmt: num(it.sgst_amount),
            CesRt: 0,
            CesAmt: 0,
            TotItemVal: num(it.total_amount),
        };
    });
    const sum = (k: 'AssAmt' | 'IgstAmt' | 'CgstAmt' | 'SgstAmt') => fromPaise(itemList.reduce((s, x) => s + toPaise(x[k]), 0));

    const json: Record<string, unknown> = {
        Version: '1.1',
        TranDtls: {
            TaxSch: 'GST',
            SupTyp: SUP_TYP[inv.supply_type] || 'B2B',
            RegRev: inv.reverse_charge ? 'Y' : 'N',
            IgstOnIntra: 'N',
        },
        DocDtls: { Typ: inv.type === 'CREDIT_NOTE' ? 'CRN' : 'INV', No: inv.invoice_number, Dt: dmySlash(inv.date) },
        SellerDtls: {
            Gstin: company.gstin,
            LglNm: company.name,
            Addr1: String(company.address || '').slice(0, 100),
            Loc: company.city,
            Pin: Number(company.pincode),
            Stcd: stateCode(company.state) || company.gstin?.slice(0, 2),
            ...(company.phone ? { Ph: String(company.phone).replace(/\D/g, '').slice(-12) } : {}),
            ...(company.email ? { Em: company.email } : {}),
        },
        BuyerDtls: isExport
            ? { Gstin: 'URP', LglNm: inv.party_name, Pos: '96', Addr1: String(inv.party_address || inv.party_name).slice(0, 100), Loc: inv.party_city || 'Overseas', Pin: 999999, Stcd: '96' }
            : {
                  Gstin: inv.party_gstin,
                  LglNm: inv.party_name,
                  Pos: pos,
                  Addr1: String(inv.party_address || '').slice(0, 100),
                  Loc: inv.party_city,
                  Pin: Number(inv.party_pincode),
                  Stcd: buyerState || inv.party_gstin?.slice(0, 2),
              },
        ItemList: itemList,
        ValDtls: {
            AssVal: sum('AssAmt'),
            CgstVal: sum('CgstAmt'),
            SgstVal: sum('SgstAmt'),
            IgstVal: sum('IgstAmt'),
            CesVal: 0,
            RndOffAmt: num(inv.round_off),
            TotInvVal: num(inv.grand_total),
        },
    };
    if (inv.type === 'CREDIT_NOTE' && inv.original_invoice_number) {
        json.RefDtls = {
            PrecDocDtls: [{ InvNo: inv.original_invoice_number, InvDt: inv.original_invoice_date ? dmySlash(inv.original_invoice_date) : dmySlash(inv.date) }],
        };
    }
    if (isExport) {
        json.ExpDtls = {
            ...(inv.shipping_bill_number ? { ShipBNo: inv.shipping_bill_number } : {}),
            ...(inv.shipping_bill_date ? { ShipBDt: dmySlash(inv.shipping_bill_date) } : {}),
            ...(inv.port_code ? { Port: inv.port_code } : {}),
        };
    }
    return { json, problems: [...new Set(problems)], invoice: { id: inv.id, number: inv.invoice_number, irn: inv.irn, irnStatus: inv.irn_status } };
};

/** All invoices in a period that need an IRN and do not have one, for bulk upload. */
export const buildEinvoiceBulk = async (companyId: string, from: string, to: string) => {
    const ids = (
        await query(
            `SELECT i.id FROM invoices i JOIN ledgers l ON l.id = i.party_ledger_id
             WHERE i.company_id = $1 AND i.type IN ('SALES', 'CREDIT_NOTE') AND i.date BETWEEN $2 AND $3
               AND (i.irn IS NULL OR i.irn_status = 'CANCELLED')
               AND ((l.gstin IS NOT NULL AND l.gstin <> '') OR i.supply_type <> 'NORMAL')
             ORDER BY i.date, i.invoice_number`,
            [companyId, from, to]
        )
    ).rows.map((r) => r.id);
    const docs = [];
    const problems: { number: string; problems: string[] }[] = [];
    for (const id of ids) {
        const e = await buildEinvoice(id);
        if (e.problems.length) problems.push({ number: e.invoice.number, problems: e.problems });
        else docs.push(e.json);
    }
    return { docs, problems };
};

/** Saves the IRN details returned by the IRP (pasted in, or from a GSP integration). */
export const recordIrn = async (
    companyId: string,
    invoiceId: string,
    data: { irn: string; ackNo: string; ackDate: string; signedQr?: string | null }
) => {
    if (!/^[0-9a-f]{64}$/i.test(data.irn || '')) throw new AppError('IRN must be the 64-character hash returned by the IRP', 400);
    const r = await query(
        `UPDATE invoices SET irn = lower($1), irn_ack_no = $2, irn_ack_date = $3, irn_signed_qr = $4, irn_status = 'ACTIVE'
         WHERE id = $5 AND company_id = $6 AND type IN ('SALES', 'CREDIT_NOTE') RETURNING id`,
        [data.irn, data.ackNo, data.ackDate, data.signedQr || null, invoiceId, companyId]
    );
    if (!r.rows.length) throw new AppError('Invoice not found', 404);
};

/** Marks the IRN cancelled (after cancelling it on the IRP, allowed within 24 hours). */
export const cancelIrn = async (companyId: string, invoiceId: string) => {
    const r = await query(
        `UPDATE invoices SET irn_status = 'CANCELLED' WHERE id = $1 AND company_id = $2 AND irn IS NOT NULL RETURNING irn_ack_date`,
        [invoiceId, companyId]
    );
    if (!r.rows.length) throw new AppError('This invoice has no IRN', 400);
};
