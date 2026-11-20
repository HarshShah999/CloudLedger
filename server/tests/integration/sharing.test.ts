import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, closePool, createCompany, createLedger, ledgerByName, registerUser, resetDatabase } from './helpers';

let token: string;
let companyId: string;
let invoiceId: string;
let party: { id: string };

beforeAll(async () => {
    await resetDatabase();
    ({ token } = await registerUser('Owner'));
    ({ id: companyId } = await createCompany(token));
    await api().put(`/api/companies/${companyId}`).set(auth(token)).send({
        upiId: 'acme@okhdfcbank', bankName: 'HDFC Bank', bankAccountNumber: '50100012345678', bankIfsc: 'HDFC0001234',
    });
    party = await createLedger(token, companyId, 'Ravi Stores', 'Sundry Debtors', {
        state: 'Maharashtra', phone: '98765 43210', email: 'ravi@example.com', address: '12 MG Road, Pune',
    });
    const sales = await ledgerByName(token, companyId, 'Sales');
    const inv = await api().post('/api/invoices').set(auth(token)).send({
        companyId, type: 'SALES', partyLedgerId: party.id, salesLedgerId: sales.id, date: '2025-06-10', dueDate: '2025-07-10',
        items: [{ description: 'Steel rods', quantity: 10, rate: 250, taxRate: 18 }],
    });
    invoiceId = inv.body.data.invoice.id;
});

afterAll(closePool);

describe('invoice sharing', () => {
    let shareToken: string;

    it('creates a public link with WhatsApp, email and UPI details', async () => {
        const res = await api().post(`/api/invoices/${invoiceId}/share`).set(auth(token));
        expect(res.status).toBe(201);
        const d = res.body.data;
        expect(d.url).toMatch(/\/v\/[A-Za-z0-9_-]{20,}$/);
        shareToken = d.url.split('/v/')[1];
        expect(d.whatsappUrl.startsWith('https://wa.me/919876543210?text=')).toBe(true);
        expect(decodeURIComponent(d.whatsappUrl)).toContain(d.url);
        expect(d.message).toContain('Ravi Stores');
        expect(d.message).toContain('₹2,950.00');
        expect(d.email.to).toBe('ravi@example.com');
        expect(d.upiLink).toContain('am=2950.00');
    });

    it('serves the shared invoice without login, with a UPI QR code', async () => {
        const res = await api().get(`/api/public/d/${shareToken}`);
        expect(res.status).toBe(200);
        expect(res.body.data.invoice.number).toBe('INV/25-26/0001');
        expect(res.body.data.totals.grandTotal).toBe(2950);
        expect(res.body.data.upi.qr.startsWith('data:image/png;base64,')).toBe(true);
        expect(res.body.data.company.bank.ifsc).toBe('HDFC0001234');
        // internal ids are not exposed
        expect(JSON.stringify(res.body)).not.toContain(companyId);
    });

    it('serves a real PDF for the shared invoice and for logged-in download', async () => {
        const pub = await api().get(`/api/public/d/${shareToken}/pdf`).buffer(true).parse((r, cb) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
        expect(pub.status).toBe(200);
        expect(pub.headers['content-type']).toBe('application/pdf');
        expect((pub.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

        const own = await api().get(`/api/invoices/${invoiceId}/pdf`).set(auth(token));
        expect(own.status).toBe(200);
        expect(own.headers['content-disposition']).toContain('INV-25-26-0001.pdf');
    });

    it('rejects unknown tokens and stops working once revoked', async () => {
        expect((await api().get('/api/public/d/not-a-real-token-1234567890')).status).toBe(404);
        expect((await api().delete(`/api/invoices/${invoiceId}/share`).set(auth(token))).status).toBe(200);
        expect((await api().get(`/api/public/d/${shareToken}`)).status).toBe(404);
    });

    it('logs shares and lists them', async () => {
        await api().post(`/api/invoices/${invoiceId}/share-log`).set(auth(token)).send({ channel: 'whatsapp', recipient: '919876543210' });
        const r = await api().get(`/api/invoices/${invoiceId}/communications`).set(auth(token));
        expect(r.body.data.communications[0].channel).toBe('WHATSAPP');
        expect((await api().post(`/api/invoices/${invoiceId}/share-log`).set(auth(token)).send({ channel: 'pigeon' })).status).toBe(400);
    });

    it('does not let another company share this invoice', async () => {
        const { token: other } = await registerUser('Other');
        expect((await api().post(`/api/invoices/${invoiceId}/share`).set(auth(other))).status).toBe(403);
    });
});

describe('statement sharing', () => {
    it('shares a party statement for a period', async () => {
        const res = await api()
            .post(`/api/ledgers/${party.id}/statement/share`)
            .set(auth(token))
            .send({ startDate: '2025-04-01', endDate: '2026-03-31' });
        expect(res.status).toBe(201);
        const t = res.body.data.url.split('/v/')[1];
        const pub = await api().get(`/api/public/d/${t}`);
        expect(pub.body.data.docType).toBe('LEDGER_STATEMENT');
        expect(pub.body.data.statement.ledger.closing_balance).toBe(2950);
        expect(pub.body.data.statement.ledger.closing_balance_type).toBe('Dr');

        const pdf = await api().get(`/api/ledgers/${party.id}/statement/pdf`).query({ startDate: '2025-04-01', endDate: '2026-03-31' }).set(auth(token));
        expect(pdf.status).toBe(200);
        expect(pdf.headers['content-type']).toBe('application/pdf');
    });
});

describe('company payment settings', () => {
    it('validates UPI and IFSC', async () => {
        const bad = await api().put(`/api/companies/${companyId}`).set(auth(token)).send({ upiId: 'not-upi', bankIfsc: 'XYZ' });
        expect(bad.status).toBe(400);
    });
});
