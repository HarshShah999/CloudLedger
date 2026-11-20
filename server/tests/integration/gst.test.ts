import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { api, auth, closePool, createCompany, createLedger, ledgerByName, registerUser, resetDatabase } from './helpers';

let token: string;
let companyId: string;
const L: Record<string, { id: string }> = {};
const ids: Record<string, string> = {};

const sale = async (party: string, date: string, rate: number, taxRate: number, extra: object = {}, type = 'SALES', account = 'sales') => {
    const r = await api().post('/api/invoices').set(auth(token)).send({
        companyId, type, partyLedgerId: L[party].id, salesLedgerId: L[account].id, date,
        items: [{ itemId: ids.item, description: 'Steel', quantity: 1, rate, taxRate }], ...extra,
    });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body.data.invoice;
};

const voucherLines = async (voucherId: string) =>
    (
        await pool.query(
            `SELECT l.name, ve.type, ve.amount::float AS amount FROM voucher_entries ve JOIN ledgers l ON l.id = ve.ledger_id
             WHERE ve.voucher_id = $1 ORDER BY l.name`,
            [voucherId]
        )
    ).rows;

beforeAll(async () => {
    await resetDatabase();
    ({ token } = await registerUser('Owner'));
    ({ id: companyId } = await createCompany(token)); // Maharashtra, GSTIN 27ABCDE1234F1Z0
    L.b2b = await createLedger(token, companyId, 'Registered Buyer', 'Sundry Debtors', { gstin: '27AAACS1234K1ZH' });
    L.delhiB2b = await createLedger(token, companyId, 'Delhi Buyer', 'Sundry Debtors', { gstin: '07AABCU9603R1ZP' });
    L.walkIn = await createLedger(token, companyId, 'Walk-in', 'Sundry Debtors', { state: 'Maharashtra' });
    L.bigUnreg = await createLedger(token, companyId, 'Karnataka Consumer', 'Sundry Debtors', { state: 'Karnataka' });
    L.sez = await createLedger(token, companyId, 'SEZ Unit', 'Sundry Debtors', { gstin: '29AAGCB7383J1Z4', gstRegistrationType: 'SEZ' });
    L.foreign = await createLedger(token, companyId, 'US Client', 'Sundry Debtors', { gstRegistrationType: 'OVERSEAS', state: 'Foreign Country' });
    L.supplier = await createLedger(token, companyId, 'Steel Supplier', 'Sundry Creditors', { gstin: '27AABCU9603R1ZN' });
    L.lawyer = await createLedger(token, companyId, 'Advocate Rao', 'Sundry Creditors', { state: 'Maharashtra', pan: 'ABCPR1234K' });
    L.sales = await ledgerByName(token, companyId, 'Sales');
    L.purchase = await ledgerByName(token, companyId, 'Purchase');
    const unit = await api().post('/api/inventory/units').set(auth(token)).send({ companyId, name: 'Kilogram', symbol: 'kg' });
    const item = await api().post('/api/inventory/items').set(auth(token)).send({ companyId, name: 'TMT Bar', hsnCode: '7214', taxRate: 18, unitId: unit.body.data.unit.id });
    ids.item = item.body.data.item.id;
});

afterAll(closePool);

describe('party GST validation', () => {
    it('rejects a wrong GSTIN check digit and a GSTIN from another state', async () => {
        const typo = await api().post('/api/ledgers').set(auth(token)).send({
            companyId, name: 'Typo', groupId: (await pool.query(`SELECT group_id FROM ledgers WHERE id = $1`, [L.b2b.id])).rows[0].group_id,
            gstin: '27AAACS1234K1ZX',
        });
        expect(typo.status).toBe(400);
        expect(typo.body.message).toMatch(/check digit/);
        const wrongState = await api().put(`/api/ledgers/${L.b2b.id}`).set(auth(token)).send({ state: 'Gujarat' });
        expect(wrongState.status).toBe(400);
    });

    it('fills state and PAN from the GSTIN', async () => {
        const r = await pool.query('SELECT state, pan, gst_registration_type FROM ledgers WHERE id = $1', [L.delhiB2b.id]);
        expect(r.rows[0]).toEqual({ state: 'Delhi', pan: 'AABCU9603R', gst_registration_type: 'REGULAR' });
    });
});

describe('supply types', () => {
    it('SEZ without payment: IGST rate shown, no tax, IGST forced', async () => {
        const inv = await sale('sez', '2025-06-03', 50000, 18, { supplyType: 'SEZ_WOPAY' });
        expect(Number(inv.tax_total)).toBe(0);
        expect(Number(inv.grand_total)).toBe(50000);
        const line = (await pool.query('SELECT igst_rate, cgst_rate FROM invoice_items WHERE invoice_id = $1', [inv.id])).rows[0];
        expect(Number(line.igst_rate)).toBe(18);
        expect(Number(line.cgst_rate)).toBe(0);
    });

    it('defaults an overseas party to export and place of supply to Foreign Country', async () => {
        const inv = await sale('foreign', '2025-06-04', 20000, 18, { supplyType: 'EXPORT_WOPAY', shippingBillNumber: '1234567', shippingBillDate: '2025-06-05', portCode: 'INNSA1' });
        expect(inv.supply_type).toBe('EXPORT_WOPAY');
        expect(inv.place_of_supply).toBe('Foreign Country');
        expect(Number(inv.tax_total)).toBe(0);
    });
});

describe('reverse charge purchase', () => {
    it('pays the supplier without GST and books ITC against an RCM liability', async () => {
        const inv = await sale('lawyer', '2025-06-10', 10000, 18, { reverseCharge: true }, 'PURCHASE', 'purchase');
        expect(Number(inv.grand_total)).toBe(10000);
        expect(Number(inv.tax_total)).toBe(1800);
        const lines = await voucherLines(inv.voucher_id);
        expect(lines).toEqual(
            expect.arrayContaining([
                { name: 'Advocate Rao', type: 'Cr', amount: 10000 },
                { name: 'Purchase', type: 'Dr', amount: 10000 },
                { name: 'Input CGST', type: 'Dr', amount: 900 },
                { name: 'CGST Payable (Reverse Charge)', type: 'Cr', amount: 900 },
                { name: 'Input SGST', type: 'Dr', amount: 900 },
                { name: 'SGST Payable (Reverse Charge)', type: 'Cr', amount: 900 },
            ])
        );
        expect((await api().post('/api/invoices').set(auth(token)).send({
            companyId, type: 'SALES', partyLedgerId: L.b2b.id, salesLedgerId: L.sales.id, date: '2025-06-10', reverseCharge: true,
            items: [{ description: 'x', quantity: 1, rate: 1, taxRate: 0 }],
        })).status).toBe(400);
    });
});

describe('TDS on purchase', () => {
    it('credits the supplier net of TDS and TDS Payable with the deduction', async () => {
        const inv = await sale('supplier', '2025-06-12', 100000, 18, { tdsSection: '194Q', tdsRate: 0.1 }, 'PURCHASE', 'purchase');
        expect(Number(inv.tds_amount)).toBe(100); // 0.1% of 1,00,000 (excluding GST)
        expect(Number(inv.outstanding_amount)).toBe(117900);
        const lines = await voucherLines(inv.voucher_id);
        expect(lines).toEqual(expect.arrayContaining([
            { name: 'Steel Supplier', type: 'Cr', amount: 117900 },
            { name: 'TDS Payable', type: 'Cr', amount: 100 },
        ]));
        const pay = await api().post('/api/payments').set(auth(token)).send({ companyId, invoiceId: inv.id, paymentDate: '2025-06-20', amount: 117900, paymentMode: 'Cash' });
        expect(pay.status).toBe(201);
        const after = await api().get(`/api/invoices/${inv.id}`).set(auth(token));
        expect(after.body.data.invoice.payment_status).toBe('PAID');

        const reg = await api().get(`/api/gst/tds/${companyId}`).query({ fromDate: '2025-06-01', toDate: '2025-06-30' }).set(auth(token));
        expect(reg.body.data.sections).toEqual([{ section: '194Q', base: 100000, tds: 100, count: 1 }]);
    });
});

describe('GSTR-1 JSON', () => {
    let json: any;
    beforeAll(async () => {
        await sale('b2b', '2025-06-01', 1000, 18);
        await sale('delhiB2b', '2025-06-02', 2000, 12);
        await sale('walkIn', '2025-06-05', 500, 18);
        await sale('walkIn', '2025-06-06', 300, 18);
        await sale('bigUnreg', '2025-06-07', 150000, 18); // inter-state unregistered > 1 lakh -> B2CL
        await sale('bigUnreg', '2025-06-08', 50000, 18); // inter-state, small -> B2CS INTER
        await sale('b2b', '2025-06-15', 200, 18, { originalInvoiceNumber: 'INV/25-26/0001' }, 'CREDIT_NOTE');
        const r = await api().get(`/api/gst/gstr1/${companyId}/json`).query({ fromDate: '2025-06-01', toDate: '2025-06-30' }).set(auth(token));
        expect(r.status).toBe(200);
        expect(r.headers['content-disposition']).toContain('GSTR1_27ABCDE1234F1Z0_062025.json');
        json = JSON.parse(r.text);
    });

    it('has the header and B2B by buyer GSTIN with tax split by rate', () => {
        expect(json.gstin).toBe('27ABCDE1234F1Z0');
        expect(json.fp).toBe('062025');
        const mh = json.b2b.find((x: any) => x.ctin === '27AAACS1234K1ZH');
        expect(mh.inv[0]).toMatchObject({ inum: 'INV/25-26/0003', idt: '01-06-2025', val: 1180, pos: '27', rchrg: 'N', inv_typ: 'R' });
        expect(mh.inv[0].itms[0].itm_det).toEqual({ txval: 1000, rt: 18, iamt: 0, camt: 90, samt: 90, csamt: 0 });
        const dl = json.b2b.find((x: any) => x.ctin === '07AABCU9603R1ZP');
        expect(dl.inv[0].pos).toBe('07');
        expect(dl.inv[0].itms[0].itm_det.iamt).toBe(240);
    });

    it('reports SEZ supplies as B2B with SEWOP', () => {
        const sez = json.b2b.find((x: any) => x.ctin === '29AAGCB7383J1Z4');
        expect(sez.inv[0].inv_typ).toBe('SEWOP');
    });

    it('puts large inter-state unregistered sales in B2CL and aggregates the rest in B2CS', () => {
        expect(json.b2cl).toEqual([{ pos: '29', inv: [expect.objectContaining({ val: 177000 })] }]);
        const intra = json.b2cs.find((x: any) => x.sply_ty === 'INTRA' && x.rt === 18);
        expect(intra).toMatchObject({ pos: '27', typ: 'OE', txval: 800, camt: 72, samt: 72 });
        const inter = json.b2cs.find((x: any) => x.sply_ty === 'INTER');
        expect(inter).toMatchObject({ pos: '29', txval: 50000, iamt: 9000 });
    });

    it('includes credit notes, exports, HSN (B2B/B2C) and documents issued', () => {
        expect(json.cdnr[0].nt[0]).toMatchObject({ ntty: 'C', nt_num: 'CN/25-26/0001', val: 236 });
        expect(json.exp[0]).toMatchObject({ exp_typ: 'WOPAY' });
        expect(json.exp[0].inv[0]).toMatchObject({ sbnum: '1234567', sbpcode: 'INNSA1', sbdt: '05-06-2025' });
        const b2bHsn = json.hsn.hsn_b2b.find((h: any) => h.hsn_sc === '7214' && h.rt === 18);
        // 1000 + 50000 (SEZ) - 200 (credit note)
        expect(b2bHsn).toMatchObject({ uqc: 'KGS', txval: 50800 });
        expect(json.hsn.hsn_b2c.length).toBeGreaterThan(0);
        expect(json.doc_issue.doc_det.map((d: any) => d.doc_num)).toEqual([1, 5]);
    });
});

describe('GSTR-3B', () => {
    it('separates zero-rated, RCM and ITC', async () => {
        const r = await api().get(`/api/gst/gstr3b/${companyId}`).query({ fromDate: '2025-06-01', toDate: '2025-06-30' }).set(auth(token));
        const t = r.body.data.tables;
        expect(t['3.1(b)'].taxable_value).toBe(70000); // SEZ 50,000 + export 20,000
        expect(t['3.1(d)']).toMatchObject({ taxable_value: 10000, cgst: 900, sgst: 900 });
        expect(t['4(A)(3)']).toMatchObject({ cgst: 900, sgst: 900 });
        expect(t['4(A)(5)']).toMatchObject({ cgst: 9000, sgst: 9000 });
        expect(r.body.data.rcm_cash).toMatchObject({ cgst: 900, sgst: 900 });
    });
});

describe('GSTR-2B reconciliation', () => {
    it('matches by supplier GSTIN and invoice number, flags differences and gaps', async () => {
        // Books: bill from Steel Supplier recorded as "ss/77"
        const bill = await api().post('/api/invoices').set(auth(token)).send({
            companyId, type: 'PURCHASE', partyLedgerId: L.supplier.id, salesLedgerId: L.purchase.id, date: '2025-07-03', invoiceNumber: 'ss/77',
            items: [{ description: 'Steel', quantity: 1, rate: 5000, taxRate: 18 }],
        });
        expect(bill.status).toBe(201);
        const upload = await api().post(`/api/gst/gstr2b/${companyId}`).set(auth(token)).send({
            fileName: 'GSTR2B_072025.json',
            content: JSON.stringify({
                data: {
                    gstin: '27ABCDE1234F1Z0',
                    rtnprd: '072025',
                    docdata: {
                        b2b: [
                            { ctin: '27AABCU9603R1ZN', trdnm: 'Steel Supplier', inv: [
                                { inum: 'SS-0077', dt: '03-07-2025', val: 5900, items: [{ rt: 18, txval: 5000, cgst: 450, sgst: 450, igst: 0 }] },
                                { inum: 'SS-0078', dt: '04-07-2025', val: 1180, items: [{ rt: 18, txval: 1000, cgst: 90, sgst: 90 }] },
                            ] },
                        ],
                    },
                },
            }),
        });
        expect(upload.status).toBe(201);
        expect(upload.body.data).toEqual({ period: '072025', documents: 2 });

        // A bill in July the supplier did not report
        await api().post('/api/invoices').set(auth(token)).send({
            companyId, type: 'PURCHASE', partyLedgerId: L.supplier.id, salesLedgerId: L.purchase.id, date: '2025-07-15', invoiceNumber: 'SS-0099',
            items: [{ description: 'Steel', quantity: 1, rate: 2000, taxRate: 18 }],
        });

        const r = await api().get(`/api/gst/gstr2b/${companyId}/072025`).set(auth(token));
        expect(r.body.data.summary).toMatchObject({ portalInvoices: 2, matched: 1, mismatched: 0, missingInBooks: 1, missingIn2b: 1 });
        expect(r.body.data.missingInBooks[0].number).toBe('SS-0078');
        expect(r.body.data.missingIn2b[0].number).toBe('SS-0099');
        expect(r.body.data.summary.itcAtRisk).toBe(360);
    });

    it('rejects a 2B belonging to another GSTIN', async () => {
        const r = await api().post(`/api/gst/gstr2b/${companyId}`).set(auth(token)).send({
            content: { data: { gstin: '07AABCU9603R1ZP', rtnprd: '072025', docdata: { b2b: [] } } },
        });
        expect(r.status).toBe(400);
    });

    it('books still balance after all of this', async () => {
        const tb = await api().get('/api/reports/trial-balance').query({ companyId, startDate: '2025-04-01', endDate: '2026-03-31' }).set(auth(token));
        expect(tb.body.data.totals.difference).toBe(0);
    });
});
