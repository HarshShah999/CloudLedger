import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { api, auth, closePool, createCompany, createLedger, ledgerByName, registerUser, resetDatabase } from './helpers';

let token: string;
let companyId: string;
let itemId: string;
const L: Record<string, any> = {};

const doc = (type: string, date: string, quantity: number, rate: number, extra: object = {}) =>
    api().post('/api/invoices').set(auth(token)).send({
        companyId, type, date,
        partyLedgerId: type === 'PURCHASE' || type === 'DEBIT_NOTE' ? L.supplier.id : L.customer.id,
        salesLedgerId: type === 'PURCHASE' || type === 'DEBIT_NOTE' ? L.purchase.id : L.sales.id,
        items: [{ itemId, quantity, rate, taxRate: 0 }],
        ...extra,
    });
const qty = async () => Number((await pool.query('SELECT current_quantity FROM items WHERE id = $1', [itemId])).rows[0].current_quantity);

beforeAll(async () => {
    await resetDatabase();
    ({ token } = await registerUser('Owner'));
    ({ id: companyId } = await createCompany(token));
    L.customer = await createLedger(token, companyId, 'Customer', 'Sundry Debtors');
    L.supplier = await createLedger(token, companyId, 'Supplier', 'Sundry Creditors');
    // Opening stock 100 x ₹10 is matched by capital, as in a real opening Balance Sheet
    L.capital = await createLedger(token, companyId, 'Owner Capital', 'Capital Account', { openingBalance: 1000, openingBalanceType: 'Cr' });
    L.sales = await ledgerByName(token, companyId, 'Sales');
    L.purchase = await ledgerByName(token, companyId, 'Purchase');
    const item = await api().post('/api/inventory/items').set(auth(token)).send({ companyId, name: 'Cement', taxRate: 0, purchaseRate: 10, openingQuantity: 100 });
    itemId = item.body.data.item.id;
});

afterAll(closePool);

describe('Stock valuation (weighted average)', () => {
    it('values stock through purchases, sales and returns', async () => {
        expect((await doc('PURCHASE', '2025-05-01', 100, 12)).status).toBe(201); // 200 @ avg 11
        const sale = await doc('SALES', '2025-05-10', 50, 20);                    // 150, value 1650
        expect(sale.status).toBe(201);
        expect((await doc('CREDIT_NOTE', '2025-05-15', 10, 20)).status).toBe(201); // back at avg 11 -> 160, 1760
        expect((await doc('DEBIT_NOTE', '2025-05-20', 20, 12)).status).toBe(201);  // out at avg 11 -> 140, 1540
        expect(await qty()).toBe(140);

        const s = await api().get('/api/reports/stock-summary').query({ companyId, asOfDate: '2025-05-31' }).set(auth(token));
        expect(s.body.data.items[0]).toMatchObject({ name: 'Cement', quantity: 140, rate: 11, value: 1540 });
        expect(s.body.data.totalValue).toBe(1540);
        // Before the purchase only the opening stock existed
        const early = await api().get('/api/reports/stock-summary').query({ companyId, asOfDate: '2025-04-30' }).set(auth(token));
        expect(early.body.data.totalValue).toBe(1000);
    });

    it('puts opening and closing stock in the Profit & Loss', async () => {
        const r = await api().get('/api/reports/pnl').query({ companyId, startDate: '2025-04-01', endDate: '2026-03-31' }).set(auth(token));
        const d = r.body.data;
        expect([d.openingStock, d.closingStock]).toEqual([1000, 1540]);
        // Net sales 800, net purchases 960: COGS = 1000 + 960 - 1540 = 420, gross profit 380
        expect(d.grossProfit).toBe(380);
        expect(d.netProfit).toBe(380);
        expect(d.expenses.find((x: any) => x.ledger_name === 'Opening Stock').balance).toBe(1000);
        expect(d.income.find((x: any) => x.ledger_name === 'Closing Stock').balance).toBe(1540);
    });

    it('shows closing stock in a balanced Balance Sheet', async () => {
        const r = await api().get('/api/reports/balance-sheet').query({ companyId, asOfDate: '2026-03-31' }).set(auth(token));
        const d = r.body.data;
        expect(d.assets.find((x: any) => x.ledger_name === 'Closing Stock').balance).toBe(1540);
        expect(d.profit.currentYear).toBe(380);
        expect(d.openingDifference).toBe(0);
        expect(d.difference).toBe(0);
    });

    it('keeps quantity in step when bills are edited or deleted, and opening stock is corrected', async () => {
        const sale = await doc('SALES', '2025-06-01', 40, 20);
        expect(await qty()).toBe(100);
        await api().put(`/api/invoices/${sale.body.data.invoice.id}`).set(auth(token)).send({
            companyId, type: 'SALES', date: '2025-06-01', partyLedgerId: L.customer.id, salesLedgerId: L.sales.id,
            items: [{ itemId, quantity: 30, rate: 20, taxRate: 0 }],
        });
        expect(await qty()).toBe(110);
        await api().delete(`/api/invoices/${sale.body.data.invoice.id}`).set(auth(token)).query({ companyId });
        expect(await qty()).toBe(140);
        // Quotations never move stock
        await doc('QUOTATION', '2025-06-02', 500, 20);
        expect(await qty()).toBe(140);
        // Correcting opening stock moves current stock with it
        await api().put(`/api/inventory/items/${itemId}`).set(auth(token)).send({ companyId, name: 'Cement', openingQuantity: 120, openingRate: 10 });
        expect(await qty()).toBe(160);
    });
});
