import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import pool from '../../src/config/db';
import { capturedMail } from '../../src/services/mailer';
import { runCompanyReminders } from '../../src/services/reminderService';
import { decryptSecret } from '../../src/utils/secrets';
import { api, auth, closePool, createCompany, createLedger, ledgerByName, registerUser, resetDatabase } from './helpers';

let token: string;
let companyId: string;
let buyer: { id: string };
let sales: { id: string };
let itemId: string;
let invoiceId: string;

beforeAll(async () => {
    await resetDatabase();
    ({ token } = await registerUser('Owner'));
    ({ id: companyId } = await createCompany(token));
    await api().put(`/api/companies/${companyId}`).set(auth(token)).send({ address: '201 Shivam Complex, FC Road', city: 'Pune', pincode: '411004' });
    buyer = await createLedger(token, companyId, 'Registered Buyer', 'Sundry Debtors', {
        gstin: '29AAGCB7383J1Z4', address: '12 MG Road', city: 'Bengaluru', pincode: '560001', email: 'buyer@example.com', phone: '9876543210',
    });
    sales = await ledgerByName(token, companyId, 'Sales');
    const unit = await api().post('/api/inventory/units').set(auth(token)).send({ companyId, name: 'Kilogram', symbol: 'kg' });
    const item = await api().post('/api/inventory/items').set(auth(token)).send({ companyId, name: 'TMT Bar', hsnCode: '7214', taxRate: 18, unitId: unit.body.data.unit.id });
    itemId = item.body.data.item.id;
    const inv = await api().post('/api/invoices').set(auth(token)).send({
        companyId, type: 'SALES', partyLedgerId: buyer.id, salesLedgerId: sales.id, date: '2025-06-10', dueDate: '2025-06-25',
        transportMode: 'ROAD', vehicleNumber: 'mh 12 ab 1234', transportDistanceKm: 840,
        items: [{ itemId, description: 'TMT Bar', quantity: 1000, rate: 62.5, taxRate: 18 }],
    });
    invoiceId = inv.body.data.invoice.id;
});

afterAll(closePool);
afterEach(() => vi.unstubAllGlobals());

describe('e-invoice', () => {
    it('builds the NIC INV-01 v1.1 payload with no problems', async () => {
        const r = await api().get(`/api/invoices/${invoiceId}/einvoice`).set(auth(token));
        expect(r.body.data.problems).toEqual([]);
        const j = r.body.data.json;
        expect(j.Version).toBe('1.1');
        expect(j.TranDtls).toMatchObject({ TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N' });
        expect(j.DocDtls).toEqual({ Typ: 'INV', No: 'INV/25-26/0001', Dt: '10/06/2025' });
        expect(j.SellerDtls).toMatchObject({ Gstin: '27ABCDE1234F1Z0', Loc: 'Pune', Pin: 411004, Stcd: '27' });
        expect(j.BuyerDtls).toMatchObject({ Gstin: '29AAGCB7383J1Z4', Pos: '29', Pin: 560001, Stcd: '29' });
        expect(j.ItemList[0]).toMatchObject({ SlNo: '1', HsnCd: '7214', IsServc: 'N', Unit: 'KGS', Qty: 1000, AssAmt: 62500, GstRt: 18, IgstAmt: 11250 });
        expect(j.ValDtls).toMatchObject({ AssVal: 62500, IgstVal: 11250, TotInvVal: 73750 });
    });

    it('lists what is missing for a buyer without PIN/address', async () => {
        const bare = await createLedger(token, companyId, 'Bare Buyer', 'Sundry Debtors', { gstin: '27AAACS1234K1ZH' });
        const inv = await api().post('/api/invoices').set(auth(token)).send({
            companyId, type: 'SALES', partyLedgerId: bare.id, salesLedgerId: sales.id, date: '2025-06-11',
            items: [{ description: 'Consulting', quantity: 1, rate: 100, taxRate: 18 }],
        });
        const r = await api().get(`/api/invoices/${inv.body.data.invoice.id}/einvoice`).set(auth(token));
        expect(r.body.data.problems.join(' ')).toMatch(/PIN code/);
        expect(r.body.data.problems.join(' ')).toMatch(/HSN/);
        expect((await api().get(`/api/invoices/${inv.body.data.invoice.id}/einvoice`).query({ download: 1 }).set(auth(token))).status).toBe(400);
        const bulk = await api().get('/api/invoices/einvoice/bulk').query({ companyId, fromDate: '2025-06-01', toDate: '2025-06-30' }).set(auth(token));
        expect(bulk.body.data).toMatchObject({ count: 1, problems: [expect.objectContaining({ number: 'INV/25-26/0002' })] });
    });

    it('records the IRN, prints it and locks the invoice', async () => {
        const irn = 'a'.repeat(64);
        expect((await api().post(`/api/invoices/${invoiceId}/irn`).set(auth(token)).send({ irn: 'short', ackNo: '1', ackDate: '2025-06-10' })).status).toBe(400);
        const ok = await api().post(`/api/invoices/${invoiceId}/irn`).set(auth(token)).send({
            irn, ackNo: '112510012345678', ackDate: '2025-06-10 11:05:00', signedQr: 'eyJhbGciOiJSUzI1NiJ9.signed.payload',
        });
        expect(ok.status).toBe(200);

        const edit = await api().put(`/api/invoices/${invoiceId}`).set(auth(token)).send({
            type: 'SALES', partyLedgerId: buyer.id, salesLedgerId: sales.id, date: '2025-06-10',
            items: [{ itemId, description: 'TMT Bar', quantity: 1, rate: 1, taxRate: 18 }],
        });
        expect(edit.status).toBe(400);
        expect(edit.body.message).toMatch(/IRN/);
        expect((await api().delete(`/api/invoices/${invoiceId}`).set(auth(token))).status).toBe(400);

        const pdf = await api().get(`/api/invoices/${invoiceId}/pdf`).set(auth(token));
        expect(pdf.status).toBe(200);
    });
});

describe('e-way bill', () => {
    it('builds the bulk-upload entry with transport details', async () => {
        const r = await api().get(`/api/invoices/${invoiceId}/ewaybill`).set(auth(token));
        expect(r.body.data.problems).toEqual([]);
        expect(r.body.data.required).toBe(true); // goods worth ₹73,750 > ₹50,000
        expect(r.body.data.bill).toMatchObject({
            supplyType: 'O', subSupplyType: 1, docType: 'INV', docNo: 'INV/25-26/0001', docDate: '10/06/2025',
            fromPincode: 411004, fromStateCode: 27, toGstin: '29AAGCB7383J1Z4', toPincode: 560001, toStateCode: 29,
            igstValue: 11250, totInvValue: 73750, transMode: '1', transDistance: '840', vehicleNo: 'MH12AB1234',
        });
        expect(r.body.data.bill.itemList[0]).toMatchObject({ hsnCode: 7214, qtyUnit: 'KGS', igstRate: 18 });
    });

    it('records the e-way bill number (12 digits)', async () => {
        expect((await api().post(`/api/invoices/${invoiceId}/ewaybill`).set(auth(token)).send({ ewbNumber: '123', ewbDate: '2025-06-10' })).status).toBe(400);
        expect((await api().post(`/api/invoices/${invoiceId}/ewaybill`).set(auth(token)).send({ ewbNumber: '331001234567', ewbDate: '2025-06-10 12:00', validUntil: '2025-06-15 23:59' })).status).toBe(200);
        const inv = await api().get(`/api/invoices/${invoiceId}`).set(auth(token));
        expect(inv.body.data.invoice.ewb_number).toBe('331001234567');
    });
});

describe('payment reminders', () => {
    it('stores the WhatsApp token encrypted and never returns it', async () => {
        const r = await api().put(`/api/companies/${companyId}`).set(auth(token)).send({
            remindersEnabled: true, reminderDays: '0,7', reminderChannels: 'EMAIL,WHATSAPP',
            whatsappPhoneNumberId: '123456789012345', whatsappToken: 'EAAG-secret-token', whatsappTemplate: 'payment_reminder',
        });
        expect(r.status).toBe(200);
        expect(JSON.stringify(r.body)).not.toContain('EAAG-secret-token');
        expect(r.body.data.company.has_whatsapp_token).toBe(true);
        const stored = (await pool.query('SELECT whatsapp_token_enc FROM companies WHERE id = $1', [companyId])).rows[0].whatsapp_token_enc;
        expect(stored).not.toContain('EAAG');
        expect(decryptSecret(stored)).toBe('EAAG-secret-token');
        const list = await api().get('/api/companies').set(auth(token));
        expect(JSON.stringify(list.body)).not.toContain(stored);
    });

    it('sends email and WhatsApp on the due day, once, and logs them', async () => {
        const calls: any[] = [];
        vi.stubGlobal('fetch', async (url: string, init: any) => {
            calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
            return new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 });
        });
        capturedMail.length = 0;

        const preview = await api().get('/api/reminders').query({ companyId }).set(auth(token));
        expect(preview.status).toBe(200);

        // invoice is due 25-06-2025
        const r = await runCompanyReminders(companyId, '2025-06-25');
        expect(r).toEqual({ sent: 2, failed: 0, skipped: 0 });
        expect(capturedMail).toHaveLength(1);
        expect(capturedMail[0].to).toBe('buyer@example.com');
        expect(capturedMail[0].subject).toMatch(/Payment reminder: invoice INV\/25-26\/0001/);
        expect(capturedMail[0].attachments[0].filename).toMatch(/\.pdf$/);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toMatch(/\/123456789012345\/messages$/);
        expect(calls[0].auth).toBe('Bearer EAAG-secret-token');
        expect(calls[0].body).toMatchObject({ to: '919876543210', type: 'template', template: { name: 'payment_reminder' } });
        expect(calls[0].body.template.components[0].parameters.map((p: any) => p.text).slice(0, 3)).toEqual([
            'Registered Buyer', 'INV/25-26/0001', '₹73,750.00',
        ]);

        // Running again the same day does not send twice
        expect(await runCompanyReminders(companyId, '2025-06-25')).toEqual({ sent: 0, failed: 0, skipped: 0 });
        // Not a reminder day
        expect(await runCompanyReminders(companyId, '2025-06-26')).toEqual({ sent: 0, failed: 0, skipped: 0 });
    });

    it('records WhatsApp API failures without stopping email', async () => {
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'Template not approved' } }), { status: 400 }));
        capturedMail.length = 0;
        const r = await runCompanyReminders(companyId, '2025-07-02'); // 7 days after due
        expect(r).toEqual({ sent: 1, failed: 1, skipped: 0 });
        const log = await pool.query(`SELECT channel, status, detail FROM reminder_log WHERE day_offset = 7 ORDER BY channel`);
        expect(log.rows).toEqual([
            { channel: 'EMAIL', status: 'SENT', detail: null },
            { channel: 'WHATSAPP', status: 'FAILED', detail: 'Template not approved' },
        ]);
    });

    it('stops reminding once the invoice is paid', async () => {
        await api().post('/api/payments').set(auth(token)).send({ companyId, invoiceId, paymentDate: '2025-07-03', amount: 73750, paymentMode: 'Cash' });
        await pool.query(`UPDATE companies SET reminder_days = '8' WHERE id = $1`, [companyId]);
        expect(await runCompanyReminders(companyId, '2025-07-03')).toEqual({ sent: 0, failed: 0, skipped: 0 });
    });
});
