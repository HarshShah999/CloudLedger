import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { api, auth, closePool, createCompany, createLedger, ledgerByName, registerUser, resetDatabase } from './helpers';

let token: string;
let companyId: string;
let ravi: { id: string };
let mehta: { id: string };
let supplier: { id: string };
let sales: { id: string };
let purchase: { id: string };
let bank: { id: string };
const inv: Record<string, string> = {};

const invoice = async (party: string, date: string, amount: number, dueDate?: string, type = 'SALES', account = sales.id) => {
    const r = await api().post('/api/invoices').set(auth(token)).send({
        companyId, type, partyLedgerId: party, salesLedgerId: account, date, dueDate,
        items: [{ description: 'Goods', quantity: 1, rate: amount, taxRate: 0 }],
    });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body.data.invoice.id as string;
};
const outstanding = async (id: string) => Number((await api().get(`/api/invoices/${id}`).set(auth(token))).body.data.invoice.outstanding_amount);

beforeAll(async () => {
    await resetDatabase();
    ({ token } = await registerUser('Owner'));
    ({ id: companyId } = await createCompany(token));
    ravi = await createLedger(token, companyId, 'Ravi Stores', 'Sundry Debtors');
    mehta = await createLedger(token, companyId, 'Mehta & Sons', 'Sundry Debtors');
    supplier = await createLedger(token, companyId, 'Steel Supplier', 'Sundry Creditors');
    bank = await createLedger(token, companyId, 'SBI Current', 'Bank Accounts');
    sales = await ledgerByName(token, companyId, 'Sales');
    purchase = await ledgerByName(token, companyId, 'Purchase');
    inv.a = await invoice(ravi.id, '2025-04-05', 1000, '2025-04-20');
    inv.b = await invoice(ravi.id, '2025-05-10', 2000, '2025-06-09');
    inv.c = await invoice(ravi.id, '2025-07-01', 500, '2025-07-31');
    inv.m = await invoice(mehta.id, '2025-06-01', 800, '2025-06-15');
    inv.p = await invoice(supplier.id, '2025-06-05', 3000, '2025-07-05', 'PURCHASE', purchase.id);
});

afterAll(closePool);

describe('bill-wise receipts', () => {
    let receiptId: string;

    it('lists a party’s open invoices oldest first', async () => {
        const r = await api().get('/api/receipts/open-invoices').query({ companyId, partyLedgerId: ravi.id, direction: 'RECEIPT' }).set(auth(token));
        expect(r.body.data.invoices.map((i: any) => i.id)).toEqual([inv.a, inv.b, inv.c]);
    });

    it('settles several invoices with one receipt and keeps the rest as an advance', async () => {
        const r = await api().post('/api/receipts').set(auth(token)).send({
            companyId, partyLedgerId: ravi.id, direction: 'RECEIPT', date: '2025-07-05', amount: 3500,
            depositLedgerId: bank.id, paymentMode: 'NEFT', referenceNumber: 'UTR123',
            allocations: [{ invoiceId: inv.a, amount: 1000 }, { invoiceId: inv.b, amount: 2000 }],
        });
        expect(r.status).toBe(201);
        receiptId = r.body.data.receipt.id;
        expect(await outstanding(inv.a)).toBe(0);
        expect(await outstanding(inv.b)).toBe(0);
        expect(await outstanding(inv.c)).toBe(500);

        const list = await api().get('/api/receipts').query({ companyId, partyLedgerId: ravi.id }).set(auth(token));
        expect(list.body.data.receipts[0].unallocated).toBe(500);

        // one voucher: Bank Dr 3500 / Ravi Cr 3500
        const v = await pool.query(`SELECT ve.type, ve.amount, l.name FROM receipts r JOIN voucher_entries ve ON ve.voucher_id = r.voucher_id JOIN ledgers l ON l.id = ve.ledger_id WHERE r.id = $1 ORDER BY ve.type DESC`, [receiptId]);
        expect(v.rows.map((x) => [x.name, x.type, Number(x.amount)])).toEqual([['SBI Current', 'Dr', 3500], ['Ravi Stores', 'Cr', 3500]]);
    });

    it('allocates the advance to a later invoice', async () => {
        const r = await api().post(`/api/receipts/${receiptId}/allocate`).set(auth(token)).send({ allocations: [{ invoiceId: inv.c, amount: 500 }] });
        expect(r.status).toBe(200);
        expect(await outstanding(inv.c)).toBe(0);
        const over = await api().post(`/api/receipts/${receiptId}/allocate`).set(auth(token)).send({ allocations: [{ invoiceId: inv.c, amount: 1 }] });
        expect(over.status).toBe(400);
    });

    it('refuses allocations to another party or the wrong side', async () => {
        const wrongParty = await api().post('/api/receipts').set(auth(token)).send({
            companyId, partyLedgerId: ravi.id, direction: 'RECEIPT', date: '2025-07-06', amount: 100, depositLedgerId: bank.id,
            allocations: [{ invoiceId: inv.m, amount: 100 }],
        });
        expect(wrongParty.status).toBe(400);
        const wrongSide = await api().post('/api/receipts').set(auth(token)).send({
            companyId, partyLedgerId: supplier.id, direction: 'RECEIPT', date: '2025-07-06', amount: 100, depositLedgerId: bank.id,
            allocations: [{ invoiceId: inv.p, amount: 100 }],
        });
        expect(wrongSide.status).toBe(400);
        // nothing was posted by the failed attempts
        const n = await pool.query(`SELECT COUNT(*)::int n FROM receipts WHERE date = '2025-07-06'`);
        expect(n.rows[0].n).toBe(0);
    });

    it('pays a supplier and deleting the payment restores the bill', async () => {
        const r = await api().post('/api/receipts').set(auth(token)).send({
            companyId, partyLedgerId: supplier.id, direction: 'PAYMENT', date: '2025-07-10', amount: 1200, depositLedgerId: bank.id,
            allocations: [{ invoiceId: inv.p, amount: 1200 }],
        });
        expect(r.status).toBe(201);
        expect(await outstanding(inv.p)).toBe(1800);
        expect((await api().delete(`/api/receipts/${r.body.data.receipt.id}`).set(auth(token))).status).toBe(204);
        expect(await outstanding(inv.p)).toBe(3000);
    });

    it('the old one-invoice payment endpoint still works and cleans up fully', async () => {
        const p = await api().post('/api/payments').set(auth(token)).send({ companyId, invoiceId: inv.m, paymentDate: '2025-07-11', amount: 300, paymentMode: 'Cash' });
        expect(p.status).toBe(201);
        expect(await outstanding(inv.m)).toBe(500);
        await api().delete(`/api/payments/${p.body.data.payment.id}`).set(auth(token));
        expect(await outstanding(inv.m)).toBe(800);
        const orphan = await pool.query(`SELECT COUNT(*)::int n FROM receipts WHERE date = '2025-07-11'`);
        expect(orphan.rows[0].n).toBe(0);
    });
});

describe('ageing', () => {
    it('buckets receivables by days past due', async () => {
        await invoice(mehta.id, '2025-09-01', 400, '2025-09-20');
        const r = await api().get('/api/reports/ageing').query({ companyId, kind: 'receivable', asOfDate: '2025-10-01' }).set(auth(token));
        expect(r.status).toBe(200);
        const m = r.body.data.parties.find((p: any) => p.name === 'Mehta & Sons');
        // 800 due 15-Jun -> 108 days; 400 due 20-Sep -> 11 days
        expect(m.buckets.d90_plus).toBe(800);
        expect(m.buckets.d1_30).toBe(400);
        expect(m.total_due).toBe(1200);
        expect(m.ledger_balance).toBe(1200);
        expect(r.body.data.parties.find((p: any) => p.name === 'Ravi Stores')).toBeUndefined();
    });

    it('as on an earlier date ignores later payments and bills', async () => {
        const r = await api().get('/api/reports/ageing').query({ companyId, kind: 'receivable', asOfDate: '2025-06-30' }).set(auth(token));
        const ravi = r.body.data.parties.find((p: any) => p.name === 'Ravi Stores');
        expect(ravi.total_due).toBe(3000); // a + b were paid on 5-Jul
        expect(ravi.buckets.d61_90).toBe(1000); // due 20-Apr
        expect(ravi.buckets.d1_30).toBe(2000); // due 9-Jun
    });

    it('shows payables', async () => {
        const r = await api().get('/api/reports/ageing').query({ companyId, kind: 'payable', asOfDate: '2025-07-01' }).set(auth(token));
        expect(r.body.data.parties[0].name).toBe('Steel Supplier');
        expect(r.body.data.parties[0].buckets.not_due).toBe(3000);
    });
});

describe('day book', () => {
    it('lists vouchers with their entries', async () => {
        const r = await api().get('/api/reports/day-book').query({ companyId, startDate: '2025-07-05', endDate: '2025-07-05' }).set(auth(token));
        expect(r.body.data.vouchers).toHaveLength(1);
        expect(r.body.data.vouchers[0].voucher_type).toBe('Receipt');
        expect(r.body.data.vouchers[0].entries).toHaveLength(2);
    });
});

describe('quotation → sales order → invoice', () => {
    let qt: string;
    let so: string;

    it('creates a quotation that does not touch the books', async () => {
        const vouchersBefore = (await pool.query('SELECT COUNT(*)::int n FROM vouchers')).rows[0].n;
        const r = await api().post('/api/invoices').set(auth(token)).send({
            companyId, type: 'QUOTATION', partyLedgerId: mehta.id, salesLedgerId: sales.id, date: '2025-08-01', validUntil: '2025-08-15',
            items: [{ description: 'Steel rods', quantity: 10, rate: 100, taxRate: 18 }],
        });
        expect(r.status).toBe(201);
        qt = r.body.data.invoice.id;
        expect(r.body.data.invoice.invoice_number).toBe('QT/25-26/0001');
        expect(r.body.data.invoice.status).toBe('DRAFT');
        expect(r.body.data.invoice.voucher_id).toBeNull();
        expect((await pool.query('SELECT COUNT(*)::int n FROM vouchers')).rows[0].n).toBe(vouchersBefore);
        // cannot take payment against a quotation
        expect((await api().post('/api/payments').set(auth(token)).send({ companyId, invoiceId: qt, paymentDate: '2025-08-02', amount: 1 })).status).toBe(400);
    });

    it('moves through statuses and converts to a sales order', async () => {
        expect((await api().patch(`/api/invoices/${qt}/status`).set(auth(token)).send({ status: 'ACCEPTED' })).status).toBe(200);
        expect((await api().patch(`/api/invoices/${qt}/status`).set(auth(token)).send({ status: 'CLOSED' })).status).toBe(400);
        const r = await api().post(`/api/invoices/${qt}/convert`).set(auth(token)).send({ to: 'SALES_ORDER', date: '2025-08-05' });
        expect(r.status).toBe(201);
        so = r.body.data.invoice.id;
        expect(r.body.data.invoice.invoice_number).toBe('SO/25-26/0001');
        expect(r.body.data.invoice.source_document_id).toBe(qt);
        const q = await api().get(`/api/invoices/${qt}`).set(auth(token));
        expect(q.body.data.invoice.status).toBe('CONVERTED');
        expect(q.body.data.invoice.converted_to[0].id).toBe(so);
        expect((await api().post(`/api/invoices/${qt}/convert`).set(auth(token)).send({ to: 'SALES' })).status).toBe(400);
    });

    it('converts the order into a real invoice that posts', async () => {
        const r = await api().post(`/api/invoices/${so}/convert`).set(auth(token)).send({ to: 'SALES', date: '2025-08-10' });
        expect(r.status).toBe(201);
        const i = r.body.data.invoice;
        expect(i.type).toBe('SALES');
        expect(i.voucher_id).not.toBeNull();
        expect(Number(i.grand_total)).toBe(1180);
        expect(i.payment_status).toBe('UNPAID');
    });

    it('purchase orders convert to bills only', async () => {
        const po = await api().post('/api/invoices').set(auth(token)).send({
            companyId, type: 'PURCHASE_ORDER', partyLedgerId: supplier.id, salesLedgerId: purchase.id, date: '2025-08-01',
            items: [{ description: 'Coil', quantity: 2, rate: 500, taxRate: 0 }],
        });
        expect(po.body.data.invoice.invoice_number).toBe('PO/25-26/0001');
        expect((await api().post(`/api/invoices/${po.body.data.invoice.id}/convert`).set(auth(token)).send({ to: 'SALES' })).status).toBe(400);
        const bill = await api().post(`/api/invoices/${po.body.data.invoice.id}/convert`).set(auth(token)).send({ to: 'PURCHASE', invoiceNumber: 'SUP-7788' });
        expect(bill.status).toBe(201);
        expect(bill.body.data.invoice.invoice_number).toBe('SUP-7788');
    });

    it('books still balance', async () => {
        const tb = await api().get('/api/reports/trial-balance').query({ companyId, startDate: '2025-04-01', endDate: '2026-03-31' }).set(auth(token));
        expect(tb.body.data.totals.difference).toBe(0);
    });
});
