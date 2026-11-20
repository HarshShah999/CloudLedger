import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { buildGstr1 } from '../../src/services/gstReturns';
import { api, auth, closePool, createCompany, createLedger, ledgerByName, registerUser, resetDatabase } from './helpers';

let token: string;
let companyId: string;
const L: Record<string, any> = {};
const ids: string[] = [];

const sale = async (date: string, rate: number) => {
    const r = await api().post('/api/invoices').set(auth(token)).send({
        companyId, type: 'SALES', date, partyLedgerId: L.customer.id, salesLedgerId: L.sales.id,
        items: [{ description: 'Work', quantity: 1, rate, taxRate: 18 }],
    });
    expect(r.status).toBe(201);
    return r.body.data.invoice;
};

beforeAll(async () => {
    await resetDatabase();
    ({ token } = await registerUser('Owner'));
    ({ id: companyId } = await createCompany(token));
    L.customer = await createLedger(token, companyId, 'Ravi Stores', 'Sundry Debtors', { gstin: '27AAACS1234K1ZH' });
    L.sales = await ledgerByName(token, companyId, 'Sales');
    for (const [d, r] of [['2025-06-02', 1000], ['2025-06-05', 2000], ['2025-06-09', 3000]] as const) ids.push((await sale(d, r)).id);
});

afterAll(closePool);

describe('Cancelling an issued invoice', () => {
    it('keeps the number, reverses the books and drops it from outstanding', async () => {
        const r = await api().post(`/api/invoices/${ids[1]}/cancel`).set(auth(token)).send({ reason: 'Duplicate entry' });
        expect(r.status).toBe(200);
        expect(r.body.data.invoice).toMatchObject({ status: 'CANCELLED', payment_status: 'CANCELLED', cancel_reason: 'Duplicate entry', voucher_id: null, invoice_number: 'INV/25-26/0002' });

        // Party owes only the two live invoices: 1180 + 3540
        const stmt = await api().get(`/api/ledgers/${L.customer.id}/statement`).query({ companyId, startDate: '2025-04-01', endDate: '2026-03-31' }).set(auth(token));
        expect(stmt.body.data.ledger.closing_balance).toBe(4720);
        const age = await api().get('/api/reports/ageing').query({ companyId, kind: 'receivable', asOfDate: '2025-06-30' }).set(auth(token));
        expect(age.body.data.parties[0].total_due).toBe(4720);

        // The next invoice does not reuse the number
        expect((await sale('2025-06-12', 500)).invoice_number).toBe('INV/25-26/0004');
    });

    it('is reported as cancelled in GSTR-1, not as a supply', async () => {
        const g = await buildGstr1(companyId, '2025-06-01', '2025-06-30');
        const json = g.json as any;
        expect(json.b2b[0].inv.map((i: any) => i.inum)).toEqual(['INV/25-26/0001', 'INV/25-26/0003', 'INV/25-26/0004']);
        expect(json.doc_issue.doc_det[0].docs[0]).toMatchObject({ from: 'INV/25-26/0001', to: 'INV/25-26/0004', totnum: 4, cancel: 1, net_issue: 3 });
    });

    it('cannot be edited, paid or cancelled twice', async () => {
        const edit = await api().put(`/api/invoices/${ids[1]}`).set(auth(token)).send({
            companyId, type: 'SALES', date: '2025-06-05', partyLedgerId: L.customer.id, salesLedgerId: L.sales.id,
            items: [{ description: 'Work', quantity: 1, rate: 1, taxRate: 0 }],
        });
        expect(edit.status).toBe(400);
        const pay = await api().post('/api/payments').set(auth(token)).send({ companyId, invoiceId: ids[1], paymentDate: '2025-06-20', amount: 100 });
        expect(pay.status).toBe(400);
        expect((await api().post(`/api/invoices/${ids[1]}/cancel`).set(auth(token)).send({})).status).toBe(400);
    });

    it('requires receipts against the invoice to be removed first', async () => {
        const rc = await api().post('/api/receipts').set(auth(token)).send({
            companyId, partyLedgerId: L.customer.id, direction: 'RECEIPT', date: '2025-06-20', amount: 500,
            allocations: [{ invoiceId: ids[0], amount: 500 }],
        });
        expect(rc.status).toBe(201);
        const r = await api().post(`/api/invoices/${ids[0]}/cancel`).set(auth(token)).send({});
        expect(r.status).toBe(400);
        expect(r.body.message).toMatch(/receipts/);
        // A viewer cannot cancel at all
        const n = await pool.query(`SELECT COUNT(*)::int n FROM invoices WHERE company_id = $1 AND status = 'CANCELLED'`, [companyId]);
        expect(n.rows[0].n).toBe(1);
    });
});
