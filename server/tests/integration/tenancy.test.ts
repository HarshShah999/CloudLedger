import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, closePool, createCompany, createLedger, ledgerByName, registerUser, resetDatabase } from './helpers';

let owner: string;
let outsider: string;
let companyId: string;
let invoiceId: string;

beforeAll(async () => {
    await resetDatabase();
    ({ token: owner } = await registerUser('Owner'));
    ({ token: outsider } = await registerUser('Outsider'));
    ({ id: companyId } = await createCompany(owner));
    const party = await createLedger(owner, companyId, 'Party', 'Sundry Debtors');
    const sales = await ledgerByName(owner, companyId, 'Sales');
    const inv = await api().post('/api/invoices').set(auth(owner)).send({
        companyId, type: 'SALES', partyLedgerId: party.id, salesLedgerId: sales.id, date: '2025-05-01',
        items: [{ description: 'x', quantity: 1, rate: 100, taxRate: 0 }],
    });
    invoiceId = inv.body.data.invoice.id;
});

afterAll(closePool);

describe('company isolation', () => {
    it('denies list endpoints for a company you are not a member of', async () => {
        for (const path of ['/api/ledgers', '/api/invoices', '/api/vouchers', '/api/reports/trial-balance', '/api/dashboard/stats']) {
            const res = await api().get(path).query({ companyId }).set(auth(outsider));
            expect(res.status, path).toBe(403);
        }
        expect((await api().get(`/api/gst/gstr1/${companyId}`).query({ fromDate: '2025-04-01', toDate: '2025-06-30' }).set(auth(outsider))).status).toBe(403);
    });

    it('denies reading, editing or deleting another company’s invoice by id', async () => {
        expect((await api().get(`/api/invoices/${invoiceId}`).set(auth(outsider))).status).toBe(403);
        expect((await api().get(`/api/invoices/${invoiceId}/pdf`).set(auth(outsider))).status).toBe(403);
        expect((await api().delete(`/api/invoices/${invoiceId}`).set(auth(outsider))).status).toBe(403);
    });

    it('does not let a user spoof companyId in the body to post into another company', async () => {
        const res = await api().post('/api/ledgers').set(auth(outsider)).send({ companyId, name: 'Hack', groupId: companyId });
        expect(res.status).toBe(403);
    });

    it('requires a token', async () => {
        expect((await api().get('/api/companies')).status).toBe(401);
    });
});

describe('roles', () => {
    it('lets an admin add a viewer who can read but not write', async () => {
        const add = await api().post(`/api/companies/${companyId}/members`).set(auth(owner)).send({
            email: 'viewer@example.com', name: 'Viewer', password: 'password123', role: 'viewer',
        });
        expect(add.status).toBe(201);
        const login = await api().post('/api/auth/login').send({ email: 'viewer@example.com', password: 'password123' });
        const viewer = login.body.token;

        expect((await api().get('/api/invoices').query({ companyId }).set(auth(viewer))).status).toBe(200);
        expect((await api().delete(`/api/invoices/${invoiceId}`).set(auth(viewer))).status).toBe(403);
        expect((await api().post(`/api/companies/${companyId}/members`).set(auth(viewer)).send({ email: 'x@example.com', role: 'admin', password: 'password123', name: 'X' })).status).toBe(403);
    });

    it('never removes the last admin', async () => {
        const members = (await api().get(`/api/companies/${companyId}/members`).set(auth(owner))).body.data.users;
        const admin = members.find((m: any) => m.role === 'admin');
        const res = await api().put(`/api/companies/${companyId}/members/${admin.id}`).set(auth(owner)).send({ role: 'viewer' });
        expect(res.status).toBe(400);
    });

    it('rejects path traversal in backup file names', async () => {
        const res = await api().get('/api/backup/full/download/..%2F..%2F.env').set(auth(owner));
        expect([400, 404]).toContain(res.status);
    });
});
