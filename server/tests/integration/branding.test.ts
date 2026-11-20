import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, closePool, createCompany, createLedger, ledgerByName, registerUser, resetDatabase } from './helpers';

const LOGO = fs.readFileSync(path.resolve(__dirname, '../../../client/src/assets/logo.png'));
const pngDataUrl = (buf: Buffer) => `data:image/png;base64,${buf.toString('base64')}`;

const binary = (req: any) =>
    req.buffer(true).parse((res: any, cb: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

/** Number of pages in a PDF produced by PDFKit (uncompressed object dictionary). */
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

let token: string;
let companyId: string;
let invoiceId: string;

beforeAll(async () => {
    await resetDatabase();
    ({ token } = await registerUser('Owner'));
    ({ id: companyId } = await createCompany(token));
    const party = await createLedger(token, companyId, 'Party', 'Sundry Debtors');
    const sales = await ledgerByName(token, companyId, 'Sales');
    const inv = await api().post('/api/invoices').set(auth(token)).send({
        companyId, type: 'SALES', partyLedgerId: party.id, salesLedgerId: sales.id, date: '2025-06-10',
        items: [{ description: 'Widget', quantity: 1, rate: 100, taxRate: 18 }],
    });
    invoiceId = inv.body.data.invoice.id;
});

afterAll(closePool);

describe('logo and signature', () => {
    it('uploads, serves and reports the logo', async () => {
        const up = await api().put(`/api/companies/${companyId}/assets/logo`).set(auth(token)).send({ dataUrl: pngDataUrl(LOGO) });
        expect(up.status).toBe(200);
        const got = await binary(api().get(`/api/companies/${companyId}/assets/logo`).set(auth(token)));
        expect(got.headers['content-type']).toBe('image/png');
        expect(Buffer.compare(got.body, LOGO)).toBe(0);
        const co = await api().get(`/api/companies/${companyId}`).set(auth(token));
        expect(co.body.data.company.has_logo).toBe(true);
    });

    it('rejects files that are not really images, and oversized ones', async () => {
        const fake = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
        expect((await api().put(`/api/companies/${companyId}/assets/logo`).set(auth(token)).send({ dataUrl: fake })).status).toBe(400);
        const big = Buffer.concat([LOGO.subarray(0, 8), Buffer.alloc(600 * 1024)]);
        expect((await api().put(`/api/companies/${companyId}/assets/signature`).set(auth(token)).send({ dataUrl: pngDataUrl(big) })).status).toBe(400);
        expect((await api().put(`/api/companies/${companyId}/assets/banner`).set(auth(token)).send({ dataUrl: pngDataUrl(LOGO) })).status).toBe(404);
    });

    it('only admins can change branding', async () => {
        await api().post(`/api/companies/${companyId}/members`).set(auth(token)).send({
            email: 'acc@example.com', name: 'Acc', password: 'password123', role: 'accountant',
        });
        const acc = (await api().post('/api/auth/login').send({ email: 'acc@example.com', password: 'password123' })).body.token;
        expect((await api().put(`/api/companies/${companyId}/assets/logo`).set(auth(acc)).send({ dataUrl: pngDataUrl(LOGO) })).status).toBe(403);
    });

    it('validates the brand colour', async () => {
        expect((await api().put(`/api/companies/${companyId}`).set(auth(token)).send({ brandColor: 'red' })).status).toBe(400);
        expect((await api().put(`/api/companies/${companyId}`).set(auth(token)).send({ brandColor: '#0F766E' })).status).toBe(200);
    });
});

describe('PDF layouts', () => {
    it('prints original, duplicate and triplicate copies in one file', async () => {
        const one = await binary(api().get(`/api/invoices/${invoiceId}/pdf`).set(auth(token)));
        const all = await binary(api().get(`/api/invoices/${invoiceId}/pdf`).query({ copies: 'all' }).set(auth(token)));
        expect(pageCount(one.body)).toBe(1);
        expect(pageCount(all.body)).toBe(3);
    });

    it('renders an 80 mm thermal receipt', async () => {
        const r = await binary(api().get(`/api/invoices/${invoiceId}/pdf`).query({ format: 'thermal' }).set(auth(token)));
        expect(r.headers['content-type']).toBe('application/pdf');
        expect(r.body.toString('latin1')).toMatch(/\/MediaBox \[0 0 226\.77/);
    });

    it('serves the logo on shared links', async () => {
        const share = await api().post(`/api/invoices/${invoiceId}/share`).set(auth(token));
        const t = share.body.data.url.split('/v/')[1];
        const doc = await api().get(`/api/public/d/${t}`);
        expect(doc.body.data.company.has_logo).toBe(true);
        expect(doc.body.data.company.brand_color).toBe('#0F766E');
        const logo = await binary(api().get(`/api/public/d/${t}/logo`));
        expect(logo.status).toBe(200);
        expect(logo.headers['content-type']).toBe('image/png');
    });
});
