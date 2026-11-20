import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { buildGstr1 } from '../../src/services/gstReturns';
import { api, auth, closePool, createCompany, registerUser, resetDatabase } from './helpers';

let token: string;
let companyId: string;

const msg = (body: string) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${body}</TALLYMESSAGE>`;
const envelope = (report: string, messages: string[]) => `<?xml version="1.0"?>
<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>${report}</REPORTNAME></REQUESTDESC><REQUESTDATA>
${messages.join('\n')}
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

const ledger = (name: string, parent: string, extra = '') => msg(`<LEDGER NAME="${name}" ACTION="Create"><PARENT>${parent}</PARENT>${extra}</LEDGER>`);
const bill = (name: string, type: string, amount: string, extra = '') =>
    `<BILLALLOCATIONS.LIST><NAME>${name}</NAME><BILLTYPE>${type}</BILLTYPE>${extra}<AMOUNT>${amount}</AMOUNT></BILLALLOCATIONS.LIST>`;
const le = (name: string, amount: string, extra = '') =>
    `<LEDGERENTRIES.LIST><LEDGERNAME>${name}</LEDGERNAME>${extra}<AMOUNT>${amount}</AMOUNT></LEDGERENTRIES.LIST>`;
const inv = (item: string, qty: string, rate: string, amount: string, ledgerName: string, allocAmount: string) =>
    `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${item}</STOCKITEMNAME><RATE>${rate}</RATE><AMOUNT>${amount}</AMOUNT>` +
    `<ACTUALQTY>${qty}</ACTUALQTY><BILLEDQTY>${qty}</BILLEDQTY>` +
    `<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${ledgerName}</LEDGERNAME><AMOUNT>${allocAmount}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>` +
    `</ALLINVENTORYENTRIES.LIST>`;
const voucher = (type: string, guid: string, date: string, number: string, body: string, extra = '') =>
    msg(`<VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>${date}</DATE><GUID>${guid}</GUID>` +
        `<VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${number}</VOUCHERNUMBER>${extra}${body}</VOUCHER>`);
const party = (name: string, amount: string, bills: string) => le(name, amount, `<ISPARTYLEDGER>Yes</ISPARTYLEDGER>${bills}`);

/** "List of Accounts" export: masters with opening bill-wise balances and custom voucher types. */
const MASTERS = envelope('All Masters', [
    msg(`<VOUCHERTYPE NAME="Sales GST"><PARENT>Sales</PARENT></VOUCHERTYPE>`),
    msg(`<VOUCHERTYPE NAME="Bank Receipt"><PARENT>Receipt</PARENT></VOUCHERTYPE>`),
    msg(`<VOUCHERTYPE NAME="Customer Order"><PARENT>Sales Order</PARENT></VOUCHERTYPE>`),
    ledger('CGST', 'Duties &amp; Taxes', '<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>Central Tax</GSTDUTYHEAD>'),
    ledger('SGST', 'Duties &amp; Taxes', '<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>State Tax</GSTDUTYHEAD>'),
    ledger('IGST', 'Duties &amp; Taxes', '<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD>'),
    ledger('TDS on Purchase 194Q', 'Duties &amp; Taxes'),
    ledger('Sales GST 18%', 'Sales Accounts'),
    ledger('Purchase GST', 'Purchase Accounts'),
    ledger('Freight Charges', 'Indirect Incomes'),
    ledger('Discount Allowed', 'Indirect Expenses'),
    ledger('Round Off', 'Indirect Expenses'),
    ledger('HDFC Bank', 'Bank Accounts', '<OPENINGBALANCE>-100000.00</OPENINGBALANCE>'),
    ledger('Capital A/c', 'Capital Account', '<OPENINGBALANCE>115000.00</OPENINGBALANCE>'),
    ledger('Ravi Stores', 'Sundry Debtors', '<LEDSTATENAME>Maharashtra</LEDSTATENAME><PARTYGSTIN>27AAACS1234K1ZH</PARTYGSTIN>'),
    ledger(
        'Mehta Traders', 'Sundry Debtors',
        '<LEDSTATENAME>Gujarat</LEDSTATENAME><PARTYGSTIN>24AAGFM1234Q1Z5</PARTYGSTIN><OPENINGBALANCE>-20000.00</OPENINGBALANCE>' +
            '<BILLALLOCATIONS.LIST><NAME>OB/1</NAME><BILLDATE>20250310</BILLDATE><BILLCREDITPERIOD>30 Days</BILLCREDITPERIOD><OPENINGBALANCE>-12000.00</OPENINGBALANCE></BILLALLOCATIONS.LIST>' +
            '<BILLALLOCATIONS.LIST><NAME>OB/2</NAME><BILLDATE>20250325</BILLDATE><OPENINGBALANCE>-8000.00</OPENINGBALANCE></BILLALLOCATIONS.LIST>'
    ),
    ledger(
        'Shree Steel', 'Sundry Creditors',
        '<LEDSTATENAME>Maharashtra</LEDSTATENAME><PARTYGSTIN>27AAKCS5678R1Z5</PARTYGSTIN><OPENINGBALANCE>5000.00</OPENINGBALANCE>' +
            '<BILLALLOCATIONS.LIST><NAME>SS/OLD</NAME><BILLDATE>20250301</BILLDATE><OPENINGBALANCE>5000.00</OPENINGBALANCE></BILLALLOCATIONS.LIST>'
    ),
    msg(`<UNIT NAME="kg"><NAME>kg</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>`),
    msg(
        `<STOCKITEM NAME="TMT Bar 12mm"><BASEUNITS>kg</BASEUNITS><OPENINGBALANCE> 500 kg</OPENINGBALANCE>` +
            `<GSTDETAILS.LIST><HSNCODE>7214</HSNCODE><STATEWISEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD><GSTRATE> 18</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST></STOCKITEM>`
    ),
]);

/** Day Book export (a separate file, as Tally users export it). */
const DAYBOOK = envelope('Day Book', [
    // Item invoice with freight, intra-state, 30 days credit
    voucher('Sales GST', 'g-sg1', '20250405', 'SG/1',
        inv('TMT Bar 12mm', ' 100 kg', '65.00/kg', '6500.00', 'Sales GST 18%', '6500.00') +
            party('Ravi Stores', '-8260.00', bill('SG/1', 'New Ref', '-8260.00', '<BILLCREDITPERIOD>30 Days</BILLCREDITPERIOD>')) +
            le('Freight Charges', '500.00') + le('CGST', '630.00') + le('SGST', '630.00'),
        '<PARTYLEDGERNAME>Ravi Stores</PARTYLEDGERNAME>'),
    // Inter-state with round off
    voucher('Sales GST', 'g-sg2', '20250406', 'SG/2',
        inv('TMT Bar 12mm', ' 3 kg', '65.50/kg', '196.50', 'Sales GST 18%', '196.50') +
            party('Mehta Traders', '-232.00', bill('SG/2', 'New Ref', '-232.00')) + le('IGST', '35.37') + le('Round Off', '0.13'),
        '<PLACEOFSUPPLY>Gujarat</PLACEOFSUPPLY>'),
    // Purchase with the supplier's bill number and TDS u/s 194Q
    voucher('Purchase', 'g-p1', '20250407', '1',
        inv('TMT Bar 12mm', ' 200 kg', '58.00/kg', '-11600.00', 'Purchase GST', '-11600.00') +
            party('Shree Steel', '13676.00', bill('SS-778', 'New Ref', '13676.00')) +
            le('CGST', '-1044.00') + le('SGST', '-1044.00') + le('TDS on Purchase 194Q', '12.00'),
        '<REFERENCE>SS-778</REFERENCE>'),
    // Receipt against an opening bill and a new bill
    voucher('Bank Receipt', 'g-br1', '20250410', 'BR/1',
        le('HDFC Bank', '-10000.00') + party('Mehta Traders', '10000.00', bill('OB/1', 'Agst Ref', '9768.00') + bill('SG/2', 'Agst Ref', '232.00'))),
    // Payment of the supplier's opening bill
    voucher('Payment', 'g-pay1', '20250411', 'PY/1',
        le('HDFC Bank', '5000.00') + party('Shree Steel', '-5000.00', bill('SS/OLD', 'Agst Ref', '-5000.00'))),
    // Sales return against SG/1
    voucher('Credit Note', 'g-cn1', '20250412', 'CN/1',
        inv('TMT Bar 12mm', ' 10 kg', '65.00/kg', '-650.00', 'Sales GST 18%', '-650.00') +
            party('Ravi Stores', '767.00', bill('SG/1', 'Agst Ref', '767.00')) + le('CGST', '-58.50') + le('SGST', '-58.50')),
    // Discount ledger before tax: GST on 900
    voucher('Sales GST', 'g-sg3', '20250413', 'SG/3',
        inv('TMT Bar 12mm', ' 10 kg', '100.00/kg', '1000.00', 'Sales GST 18%', '1000.00') +
            party('Ravi Stores', '-1062.00', bill('SG/3', 'New Ref', '-1062.00')) + le('Discount Allowed', '-100.00') + le('CGST', '81.00') + le('SGST', '81.00')),
    // Discount after tax (GST on 1000): kept in the books, flagged for review
    voucher('Sales GST', 'g-sg4', '20250413', 'SG/4',
        inv('TMT Bar 12mm', ' 10 kg', '100.00/kg', '1000.00', 'Sales GST 18%', '1000.00') +
            party('Ravi Stores', '-1080.00', bill('SG/4', 'New Ref', '-1080.00')) + le('CGST', '90.00') + le('SGST', '90.00') + le('Discount Allowed', '-100.00')),
    // Orders do not touch the books
    voucher('Customer Order', 'g-so1', '20250414', 'SO/1', party('Ravi Stores', '-500.00', '') + le('Sales GST 18%', '500.00')),
]);

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const post = (xml: string, commit = true) => api().post('/api/import/tally').set(auth(token)).send({ companyId, fileBase64: b64(xml), commit });
const invoice = async (number: string, type = 'SALES') =>
    (await pool.query('SELECT * FROM invoices WHERE company_id = $1 AND invoice_number = $2 AND type = $3', [companyId, number, type])).rows[0];
const lines = async (id: string) =>
    (await pool.query('SELECT ii.*, it.name AS item_name FROM invoice_items ii LEFT JOIN items it ON it.id = ii.item_id WHERE invoice_id = $1 ORDER BY taxable_amount DESC', [id])).rows;

beforeAll(async () => {
    await resetDatabase();
    ({ token } = await registerUser('Owner'));
    ({ id: companyId } = await createCompany(token));
});

afterAll(closePool);

describe('Moving a company from Tally', () => {
    it('imports masters with opening bills and voucher types', async () => {
        const r = await post(MASTERS);
        expect(r.status).toBe(200);
        expect(r.body.data.errors).toEqual([]);
        expect(r.body.data.created).toMatchObject({ 'opening bills': 3, 'voucher types': 3, items: 1 });
        const ob1 = await invoice('OB/1');
        expect(ob1).toMatchObject({ is_opening: true, voucher_id: null, bill_ref: 'OB/1' });
        expect(Number(ob1.grand_total)).toBe(12000);
        expect(String(ob1.due_date).slice(0, 10)).toBe('2025-04-09');
        expect((await invoice('SS/OLD', 'PURCHASE')).is_opening).toBe(true);
        const cgst = (await pool.query(`SELECT gst_tax_head FROM ledgers WHERE company_id = $1 AND name = 'CGST'`, [companyId])).rows[0];
        expect(cgst.gst_tax_head).toBe('CGST');
    });

    it('imports the Day Book as GST invoices, receipts against bills and stock', async () => {
        const r = await post(DAYBOOK);
        const d = r.body.data;
        expect(d.errors).toEqual([]);
        expect(d.created).toMatchObject({ vouchers: 8, 'sales invoices': 3, 'purchase bills': 1, 'credit notes': 1, 'receipts (bill-wise)': 1, 'payments (bill-wise)': 1 });
        expect(d.skipped['orders, delivery notes and other non-accounting vouchers']).toBe(1);
        expect(d.warnings).toHaveLength(1);
        expect(d.warnings[0]).toMatchObject({ ref: expect.stringContaining('SG/4') });
        expect(d.warnings[0].message).toMatch(/books.*Discount Allowed.*after tax/);

        // Custom voucher type "Sales GST" was filed as Sales
        const vt = await pool.query(
            `SELECT t.name FROM vouchers v JOIN voucher_types t ON t.id = v.voucher_type_id WHERE v.external_id = 'g-sg1'`
        );
        expect(vt.rows[0].name).toBe('Sales');

        // SG/1: item + freight, CGST/SGST split per line exactly as Tally's totals
        const sg1 = await invoice('SG/1');
        expect(sg1).toMatchObject({ place_of_supply: 'Maharashtra', supply_type: 'NORMAL', bill_ref: 'SG/1', is_opening: false });
        expect([Number(sg1.subtotal), Number(sg1.tax_total), Number(sg1.grand_total)]).toEqual([7000, 1260, 8260]);
        expect(String(sg1.due_date).slice(0, 10)).toBe('2025-05-05');
        const l1 = await lines(sg1.id);
        expect(l1.map((l) => [l.item_name ?? l.description, Number(l.quantity), Number(l.taxable_amount), Number(l.tax_rate), Number(l.cgst_amount), Number(l.sgst_amount)])).toEqual([
            ['TMT Bar 12mm', 100, 6500, 18, 585, 585],
            ['Freight Charges', 1, 500, 18, 45, 45],
        ]);

        // SG/2: IGST with round off, settled by the receipt
        const sg2 = await invoice('SG/2');
        expect([Number(sg2.tax_total), Number(sg2.round_off), Number(sg2.grand_total)]).toEqual([35.37, 0.13, 232]);
        expect(sg2.place_of_supply).toBe('Gujarat');
        expect(sg2.payment_status).toBe('PAID');
        expect(Number((await lines(sg2.id))[0].igst_amount)).toBe(35.37);

        // SG/3: the discount ledger lowers the taxable value
        const sg3 = await invoice('SG/3');
        const l3 = (await lines(sg3.id))[0];
        expect([Number(l3.amount), Number(l3.discount_amount), Number(l3.taxable_amount), Number(l3.tax_amount)]).toEqual([1000, 100, 900, 162]);
        expect(Number(sg3.grand_total)).toBe(1062);

        // Purchase: supplier's bill number, TDS, net payable
        const p1 = await invoice('SS-778', 'PURCHASE');
        expect([Number(p1.grand_total), Number(p1.tds_amount), Number(p1.outstanding_amount)]).toEqual([13688, 12, 13676]);

        // Credit note refers to the original invoice
        expect((await invoice('CN/1', 'CREDIT_NOTE')).original_invoice_number).toBe('SG/1');

        // Bill-wise: OB/1 part-paid, SS/OLD paid
        const ob1 = await invoice('OB/1');
        expect([ob1.payment_status, Number(ob1.outstanding_amount)]).toEqual(['PARTIAL', 2232]);
        expect((await invoice('SS/OLD', 'PURCHASE')).payment_status).toBe('PAID');

        // Stock: 500 opening - 100 - 3 + 200 + 10 returned - 10 (SG/3); SG/4 is books-only = 597
        const item = (await pool.query(`SELECT current_quantity FROM items WHERE company_id = $1`, [companyId])).rows[0];
        expect(Number(item.current_quantity)).toBe(597);
    });

    it('agrees with the books: ageing, trial balance, GSTR-1', async () => {
        const age = await api().get('/api/reports/ageing').query({ companyId, kind: 'receivable', asOfDate: '2025-04-30' }).set(auth(token));
        const mehta = age.body.data.parties.find((p: any) => p.name === 'Mehta Traders');
        // Bills (2232 + 8000) equal the ledger balance (20000 + 232 - 10000)
        expect(mehta).toMatchObject({ total_due: 10232, ledger_balance: 10232 });

        const tb = await api().get('/api/reports/trial-balance').query({ companyId, startDate: '2025-04-01', endDate: '2026-03-31' }).set(auth(token));
        expect(tb.body.data.totals.difference).toBe(0);

        const g = await buildGstr1(companyId, '2025-04-01', '2025-04-30');
        const b2b = (g.json as any).b2b as { ctin: string; inv: { inum: string }[] }[];
        const numbers = b2b.flatMap((x) => x.inv.map((i) => i.inum)).sort();
        expect(numbers).toEqual(['SG/1', 'SG/2', 'SG/3']); // no opening bills, no books-only voucher
    });

    it('re-importing the same files changes nothing', async () => {
        const m = await post(MASTERS);
        expect(m.body.data.skipped['opening bills (already imported)']).toBe(3);
        const d = await post(DAYBOOK);
        expect(d.body.data.created.vouchers).toBeUndefined();
        expect(d.body.data.skipped['vouchers (already imported)']).toBe(8);
        const n = await pool.query('SELECT COUNT(*)::int n FROM invoices WHERE company_id = $1', [companyId]);
        expect(n.rows[0].n).toBe(3 + 5);
    });

    it('runs large imports in the background with progress', async () => {
        const start = await api().post('/api/import/tally').set(auth(token)).send({ companyId, fileBase64: b64(DAYBOOK), background: true });
        expect(start.status).toBe(202);
        const jobId = start.body.data.jobId;
        let job: any;
        for (let i = 0; i < 50; i++) {
            job = (await api().get(`/api/import/jobs/${jobId}`).set(auth(token))).body.data;
            if (job.status !== 'running') break;
            await new Promise((r) => setTimeout(r, 100));
        }
        expect(job).toMatchObject({ status: 'done', dryRun: true, total: 9, done: 9 });
        expect(job.report.skipped['vouchers (already imported)']).toBe(8);
        // Someone else cannot see it
        const { token: other } = await registerUser('Other');
        expect((await api().get(`/api/import/jobs/${jobId}`).set(auth(other))).status).toBe(404);
    });

    it('does not allow editing an opening bill', async () => {
        const ob2 = await invoice('OB/2');
        const r = await api().put(`/api/invoices/${ob2.id}`).set(auth(token)).send({ companyId, partyLedgerId: ob2.party_ledger_id, salesLedgerId: ob2.sales_ledger_id, date: '2025-03-25', type: 'SALES', items: [{ quantity: 1, rate: 10, taxRate: 0 }] });
        expect(r.status).toBe(400);
        expect(r.body.message).toMatch(/Opening bills/);
    });
});
