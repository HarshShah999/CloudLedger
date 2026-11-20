import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { fromPaise, toPaise } from '../utils/money';
import { stateCode, uqcFor } from '../utils/gst';
import { loadForEDoc } from './einvoiceService';

/** Consignment value above which an e-way bill is needed (inter-state; most states use the same for intra-state). */
export const EWB_LIMIT = 50000;
const MODES: Record<string, string> = { ROAD: '1', RAIL: '2', AIR: '3', SHIP: '4' };

const dmySlash = (d: string) => {
    const [y, m, day] = String(d).slice(0, 10).split('-');
    return `${day}/${m}/${y}`;
};
const num = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;

/** Goods value (services do not move) and whether an e-way bill is required. */
export const ewbRequirement = (items: { item_type?: string | null; hsn_code?: string | null; total_amount: string | number }[]) => {
    const goods = items.filter((it) => it.item_type !== 'SERVICES' && !String(it.hsn_code || '').startsWith('99'));
    const value = fromPaise(goods.reduce((s, it) => s + toPaise(it.total_amount), 0));
    return { goodsValue: value, required: value > EWB_LIMIT, hasGoods: goods.length > 0 };
};

/** One e-way bill entry in the NIC bulk-upload format (ewaybillgst.gov.in → Generate Bulk). */
export const buildEwayBill = async (invoiceId: string) => {
    const { inv, company, items } = await loadForEDoc(invoiceId);
    const problems: string[] = [];
    if (inv.type !== 'SALES') problems.push('E-way bill JSON is generated for sales invoices');
    const req = ewbRequirement(items);
    if (!req.hasGoods) problems.push('This invoice has no goods (services do not need an e-way bill)');
    if (!company.gstin) problems.push('Company GSTIN is missing');
    if (!company.city || !/^[1-9]\d{5}$/.test(company.pincode || '')) problems.push('Company city / PIN code is missing (Settings)');
    const isExport = String(inv.supply_type).startsWith('EXPORT');
    if (!isExport && !/^[1-9]\d{5}$/.test(inv.party_pincode || '')) problems.push(`${inv.party_name}: PIN code is missing`);
    if (!inv.transport_mode) problems.push('Transport mode is missing');
    if (inv.transport_mode === 'ROAD' && !inv.vehicle_number && !inv.transporter_id) {
        problems.push('Enter the vehicle number or the transporter ID');
    }

    const goods = items.filter((it) => it.item_type !== 'SERVICES' && !String(it.hsn_code || '').startsWith('99'));
    const fromState = Number(stateCode(company.state) || company.gstin?.slice(0, 2));
    const toState = Number(isExport ? 99 : stateCode(inv.place_of_supply) || stateCode(inv.party_state) || 0);
    const t = (k: string) => fromPaise(goods.reduce((s, it) => s + toPaise(it[k]), 0));

    const bill = {
        userGstin: company.gstin,
        supplyType: 'O',
        subSupplyType: isExport ? 3 : 1,
        subSupplyDesc: '',
        docType: 'INV',
        docNo: inv.invoice_number,
        docDate: dmySlash(inv.date),
        transType: 1,
        fromGstin: company.gstin,
        fromTrdName: company.name,
        fromAddr1: String(company.address || '').slice(0, 120),
        fromAddr2: '',
        fromPlace: company.city || '',
        fromPincode: Number(company.pincode || 0),
        fromStateCode: fromState,
        actualFromStateCode: fromState,
        toGstin: inv.party_gstin || 'URP',
        toTrdName: inv.party_name,
        toAddr1: String(inv.party_address || '').slice(0, 120),
        toAddr2: '',
        toPlace: inv.party_city || '',
        toPincode: Number(isExport ? 999999 : inv.party_pincode || 0),
        toStateCode: toState,
        actualToStateCode: toState,
        totalValue: t('taxable_amount'),
        cgstValue: t('cgst_amount'),
        sgstValue: t('sgst_amount'),
        igstValue: t('igst_amount'),
        cessValue: 0,
        cessNonAdvolValue: 0,
        otherValue: num(inv.round_off),
        totInvValue: num(inv.grand_total),
        transMode: MODES[inv.transport_mode] || '1',
        transDistance: String(inv.transport_distance_km ?? 0), // 0 lets the portal compute it from PIN codes
        transporterId: inv.transporter_id || '',
        transporterName: inv.transporter_name || '',
        transDocNo: inv.transport_doc_number || '',
        transDocDate: inv.transport_doc_date ? dmySlash(inv.transport_doc_date) : '',
        vehicleNo: (inv.vehicle_number || '').replace(/[\s-]/g, '').toUpperCase(),
        vehicleType: 'R',
        itemList: goods.map((it, idx) => ({
            itemNo: idx + 1,
            productName: String(it.item_name || it.description || 'Goods').slice(0, 100),
            productDesc: String(it.description || it.item_name || '').slice(0, 100),
            hsnCode: Number(String(it.hsn_code || '0').replace(/\D/g, '') || 0),
            quantity: Number(it.quantity),
            qtyUnit: uqcFor(it.uqc, it.unit_symbol),
            taxableAmount: num(it.taxable_amount),
            sgstRate: Number(it.sgst_rate),
            cgstRate: Number(it.cgst_rate),
            igstRate: Number(it.igst_rate),
            cessRate: 0,
            cessNonadvol: 0,
        })),
    };
    goods.forEach((it, i) => {
        if (!/^\d{4,8}$/.test(String(it.hsn_code || ''))) problems.push(`Line ${i + 1}: HSN code is missing`);
    });
    return { bill, problems: [...new Set(problems)], required: req.required, goodsValue: req.goodsValue, invoice: { id: inv.id, number: inv.invoice_number, ewb: inv.ewb_number } };
};

export const buildEwayBillBulk = async (companyId: string, ids: string[]) => {
    const own = (await query('SELECT id FROM invoices WHERE company_id = $1 AND id = ANY($2::uuid[])', [companyId, ids])).rows.map((r) => r.id);
    const billLists = [];
    const problems: { number: string; problems: string[] }[] = [];
    for (const id of own) {
        const e = await buildEwayBill(id);
        if (e.problems.length) problems.push({ number: e.invoice.number, problems: e.problems });
        else billLists.push(e.bill);
    }
    return { json: { version: '1.0.0621', billLists }, problems };
};

export const recordEwayBill = async (companyId: string, invoiceId: string, data: { ewbNumber: string; ewbDate: string; validUntil?: string | null }) => {
    if (!/^\d{12}$/.test(data.ewbNumber || '')) throw new AppError('E-way bill number has 12 digits', 400);
    const r = await query(
        `UPDATE invoices SET ewb_number = $1, ewb_date = $2, ewb_valid_until = $3 WHERE id = $4 AND company_id = $5 RETURNING id`,
        [data.ewbNumber, data.ewbDate, data.validUntil || null, invoiceId, companyId]
    );
    if (!r.rows.length) throw new AppError('Invoice not found', 404);
};
