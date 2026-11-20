import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { api, auth, closePool, createCompany, createLedger, ledgerByName, registerUser, resetDatabase } from './helpers';

let token: string;
let companyId: string;
let customer: { id: string };
let interStateCustomer: { id: string };
let sales: { id: string };
let bank: { id: string };

beforeAll(async () => {
    await resetDatabase();
    ({ token } = await registerUser('Owner'));
    ({ id: companyId } = await createCompany(token));
    customer = await createLedger(token, companyId, 'Ravi Stores', 'Sundry Debtors', { state: 'Maharashtra' });
    interStateCustomer = await createLedger(token, companyId, 'Delhi Mart', 'Sundry Debtors', { state: 'Delhi' });
    sales = await ledgerByName(token, companyId, 'Sales');
    bank = await createLedger(token, companyId, 'HDFC Bank', 'Bank Accounts');
});

afterAll(closePool);

const sumEntries = async (voucherId: string) => {
    const r = await pool.query(
        `SELECT SUM(CASE WHEN type='Dr' THEN amount ELSE 0 END) dr, SUM(CASE WHEN type='Cr' THEN amount ELSE 0 END) cr
         FROM voucher_entries WHERE voucher_id = $1`,
        [voucherId]
    );
    return { dr: Number(r.rows[0].dr), cr: Number(r.rows[0].cr) };
};

describe('company setup', () => {
    it('seeds the Indian chart of accounts, tax ledgers and voucher types', async () => {
        for (const name of ['Output CGST', 'Output SGST', 'Output IGST', 'Input CGST', 'Round Off', 'Cash']) {
            expect(await ledgerByName(token, companyId, name)).toBeTruthy();
        }
        const vt = await api().get('/api/vouchers/types').query({ companyId }).set(auth(token));
        expect(vt.body.data.voucherTypes.map((v: any) => v.name)).toEqual(
            expect.arrayContaining(['Sales', 'Receipt', 'Contra', 'Credit Note', 'Debit Note'])
        );
    });

    it('makes the first registered user the platform super-admin and ignores client-sent roles', async () => {
        const me = await api().get('/api/auth/me').set(auth(token));
        expect(me.body.data.user.is_superadmin).toBe(true);

        const res = await api()
            .post('/api/auth/register')
            .send({ name: 'Mallory', email: 'mallory@example.com', password: 'password123', role: 'admin' });
        expect(res.status).toBe(201);
        expect(res.body.data.user.is_superadmin).toBe(false);
        const backup = await api().get('/api/backup/full/list').set(auth(res.body.token));
        expect(backup.status).toBe(403);
    });
});

describe('sales invoice', () => {
    let invoiceId: string;

    it('auto-numbers, posts a balanced voucher with CGST/SGST and rounds off', async () => {
        const next = await api().get('/api/invoices/next-number').query({ companyId, type: 'SALES', date: '2025-06-10' }).set(auth(token));
        expect(next.body.data.number).toBe('INV/25-26/0001');

        const res = await api()
            .post('/api/invoices')
            .set(auth(token))
            .send({
                companyId,
                type: 'SALES',
                partyLedgerId: customer.id,
                salesLedgerId: sales.id,
                date: '2025-06-10',
                dueDate: '2025-07-10',
                invoiceNumber: '',
                discountPercent: 0,
                items: [{ description: 'Widget', quantity: 3, rate: 33.33, taxRate: 18, discountPercent: 0 }],
            });
        expect(res.status).toBe(201);
        const inv = res.body.data.invoice;
        invoiceId = inv.id;
        expect(inv.invoice_number).toBe('INV/25-26/0001');
        // 99.99 + 9.00 + 9.00 = 117.99 -> 118.00
        expect(Number(inv.subtotal)).toBe(99.99);
        expect(Number(inv.tax_total)).toBe(18);
        expect(Number(inv.round_off)).toBe(0.01);
        expect(Number(inv.grand_total)).toBe(118);

        const totals = await sumEntries(inv.voucher_id);
        expect(totals.dr).toBe(totals.cr);
        expect(totals.dr).toBe(118);

        const again = await api().get('/api/invoices/next-number').query({ companyId, type: 'SALES', date: '2025-06-11' }).set(auth(token));
        expect(again.body.data.number).toBe('INV/25-26/0002');
    });

    it('rejects a duplicate invoice number in the same financial year', async () => {
        const res = await api()
            .post('/api/invoices')
            .set(auth(token))
            .send({
                companyId, type: 'SALES', partyLedgerId: customer.id, salesLedgerId: sales.id,
                date: '2025-06-12', invoiceNumber: 'INV/25-26/0001',
                items: [{ description: 'x', quantity: 1, rate: 10, taxRate: 0 }],
            });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already used/);
    });

    it('charges IGST to an inter-state customer', async () => {
        const res = await api()
            .post('/api/invoices')
            .set(auth(token))
            .send({
                companyId, type: 'SALES', partyLedgerId: interStateCustomer.id, salesLedgerId: sales.id,
                date: '2025-06-15', items: [{ description: 'Service', quantity: 1, rate: 1000, taxRate: 18 }],
            });
        expect(res.status).toBe(201);
        const detail = await api().get(`/api/invoices/${res.body.data.invoice.id}`).set(auth(token));
        expect(Number(detail.body.data.items[0].igst_amount)).toBe(180);
        expect(Number(detail.body.data.items[0].cgst_amount)).toBe(0);
    });

    it('rolls back completely when anything in the invoice is invalid', async () => {
        const before = await pool.query('SELECT COUNT(*)::int n FROM vouchers');
        const res = await api()
            .post('/api/invoices')
            .set(auth(token))
            .send({
                companyId, type: 'SALES', partyLedgerId: customer.id, salesLedgerId: sales.id, date: '2025-06-20',
                items: [{ itemId: '99999999-9999-4999-8999-999999999999', description: 'ghost', quantity: 1, rate: 5, taxRate: 0 }],
            });
        expect(res.status).toBe(400);
        const after = await pool.query('SELECT COUNT(*)::int n FROM vouchers');
        expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('records part and full payment into the chosen bank account', async () => {
        const part = await api().post('/api/payments').set(auth(token)).send({
            companyId, invoiceId, paymentDate: '2025-06-20', amount: 50, depositLedgerId: bank.id, paymentMode: 'UPI',
        });
        expect(part.status).toBe(201);
        let inv = (await api().get(`/api/invoices/${invoiceId}`).set(auth(token))).body.data.invoice;
        expect(inv.payment_status).toBe('PARTIAL');
        expect(Number(inv.outstanding_amount)).toBe(68);

        const over = await api().post('/api/payments').set(auth(token)).send({
            companyId, invoiceId, paymentDate: '2025-06-21', amount: 100, depositLedgerId: bank.id,
        });
        expect(over.status).toBe(400);

        await api().post('/api/payments').set(auth(token)).send({
            companyId, invoiceId, paymentDate: '2025-06-21', amount: 68, paymentMode: 'Cash',
        });
        inv = (await api().get(`/api/invoices/${invoiceId}`).set(auth(token))).body.data.invoice;
        expect(inv.payment_status).toBe('PAID');

        const stmt = await api().get(`/api/ledgers/${bank.id}/statement`).query({ companyId, startDate: '2025-04-01', endDate: '2026-03-31' }).set(auth(token));
        expect(stmt.body.data.ledger.closing_balance).toBe(50);
        expect(stmt.body.data.ledger.closing_balance_type).toBe('Dr');
    });

    it('blocks editing an invoice that has payments', async () => {
        const res = await api().put(`/api/invoices/${invoiceId}`).set(auth(token)).send({
            type: 'SALES', partyLedgerId: customer.id, salesLedgerId: sales.id, date: '2025-06-10',
            items: [{ description: 'x', quantity: 1, rate: 1, taxRate: 0 }],
        });
        expect(res.status).toBe(400);
    });
});

describe('reports', () => {
    it('trial balance tallies and balance sheet balances (including current profit)', async () => {
        const tb = await api().get('/api/reports/trial-balance').query({ companyId, startDate: '2025-04-01', endDate: '2026-03-31' }).set(auth(token));
        expect(tb.status).toBe(200);
        expect(tb.body.data.totals.difference).toBe(0);

        const bs = await api().get('/api/reports/balance-sheet').query({ companyId, asOfDate: '2026-03-31' }).set(auth(token));
        expect(bs.body.data.difference).toBe(0);
        const pl = bs.body.data.liabilities.find((l: any) => l.ledger_name === 'Profit & Loss A/c');
        // Sales 99.99 + 1000 taxable, round-off income 0.01 -> profit 1100.00
        expect(pl.balance).toBe(1100);

        const pnl = await api().get('/api/reports/pnl').query({ companyId, startDate: '2025-04-01', endDate: '2026-03-31' }).set(auth(token));
        expect(pnl.body.data.netProfit).toBe(1100);
        expect(pnl.body.data.netProfitType).toBe('Profit');
    });

    it('carries asset balances into the next year but resets income ledgers', async () => {
        const stmt = await api().get(`/api/ledgers/${sales.id}/statement`).query({ companyId, startDate: '2026-04-01', endDate: '2026-04-30' }).set(auth(token));
        expect(stmt.body.data.ledger.opening_balance).toBe(0);
        const bankStmt = await api().get(`/api/ledgers/${bank.id}/statement`).query({ companyId, startDate: '2026-04-01', endDate: '2026-04-30' }).set(auth(token));
        expect(bankStmt.body.data.ledger.opening_balance).toBe(50);
    });

    it('GSTR-3B sums tax once per line (not multiplied by item count)', async () => {
        const r = await api().get(`/api/gst/gstr3b/${companyId}`).query({ fromDate: '2025-06-01', toDate: '2025-06-30' }).set(auth(token));
        expect(r.body.data.outward_supplies.taxable_value).toBe(1099.99);
        expect(r.body.data.outward_supplies.igst).toBe(180);
        expect(r.body.data.outward_supplies.cgst).toBe(9);
    });
});

describe('journal vouchers and period lock', () => {
    it('rejects unbalanced journals and ledgers from another company', async () => {
        const vt = (await api().get('/api/vouchers/types').query({ companyId }).set(auth(token))).body.data.voucherTypes;
        const journal = vt.find((v: any) => v.name === 'Journal');
        const unbalanced = await api().post('/api/vouchers').set(auth(token)).send({
            companyId, voucherTypeId: journal.id, date: '2025-07-01',
            entries: [{ ledgerId: bank.id, amount: 10, type: 'Dr' }, { ledgerId: customer.id, amount: 9.99, type: 'Cr' }],
        });
        expect(unbalanced.status).toBe(400);

        const { token: other } = await registerUser('Other');
        const otherCo = await createCompany(other);
        const foreign = await createLedger(other, otherCo.id, 'Foreign', 'Sundry Debtors');
        const cross = await api().post('/api/vouchers').set(auth(token)).send({
            companyId, voucherTypeId: journal.id, date: '2025-07-01',
            entries: [{ ledgerId: bank.id, amount: 10, type: 'Dr' }, { ledgerId: foreign.id, amount: 10, type: 'Cr' }],
        });
        expect(cross.status).toBe(400);
    });

    it('prevents posting into a closed financial year', async () => {
        const fys = (await api().get('/api/financial-years').query({ companyId }).set(auth(token))).body.data.financialYears;
        const fy = fys.find((f: any) => f.name === '2025-26');
        expect((await api().put(`/api/financial-years/${fy.id}/close`).set(auth(token))).status).toBe(200);

        const res = await api().post('/api/invoices').set(auth(token)).send({
            companyId, type: 'SALES', partyLedgerId: customer.id, salesLedgerId: sales.id, date: '2025-08-01',
            items: [{ description: 'x', quantity: 1, rate: 1, taxRate: 0 }],
        });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/closed/);

        await api().put(`/api/financial-years/${fy.id}/reopen`).set(auth(token));
    });
});
