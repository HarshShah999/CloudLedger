import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { api, auth, closePool, createCompany, registerUser, resetDatabase } from './helpers';

let token: string;
let companyId: string;

const TALLY_XML = `<?xml version="1.0"?>
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC><REQUESTDATA>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <GROUP NAME="Pune Customers" ACTION="Create"><NAME>Pune Customers</NAME><PARENT>Sundry Debtors</PARENT></GROUP>
  </TALLYMESSAGE>
  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="Ravi Stores" ACTION="Create">
    <ADDRESS.LIST TYPE="String"><ADDRESS>12 MG Road</ADDRESS><ADDRESS>Camp</ADDRESS></ADDRESS.LIST>
    <PARENT>Pune Customers</PARENT>
    <LEDSTATENAME>Maharashtra</LEDSTATENAME>
    <PINCODE>411001</PINCODE>
    <EMAIL>ravi@example.com</EMAIL>
    <LEDGSTREGDETAILS.LIST><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><GSTIN>27AAACS1234K1ZH</GSTIN></LEDGSTREGDETAILS.LIST>
    <OPENINGBALANCE>-15000.00</OPENINGBALANCE>
   </LEDGER>
  </TALLYMESSAGE>
  <TALLYMESSAGE><LEDGER NAME="HDFC Bank"><PARENT>Bank Accounts</PARENT><OPENINGBALANCE>-50000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
  <TALLYMESSAGE><LEDGER NAME="Capital A/c"><PARENT>Capital Account</PARENT><OPENINGBALANCE>65000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
  <TALLYMESSAGE><LEDGER NAME="Sales"><PARENT>Sales Accounts</PARENT></LEDGER></TALLYMESSAGE>
  <TALLYMESSAGE><LEDGER NAME="Bad GST Party"><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>27AAACS1234K1ZX</PARTYGSTIN></LEDGER></TALLYMESSAGE>
  <TALLYMESSAGE><LEDGER NAME="Profit &amp; Loss A/c"><PARENT></PARENT></LEDGER></TALLYMESSAGE>
  <TALLYMESSAGE><UNIT NAME="Kgs"><NAME>Kgs</NAME><ORIGINALNAME>Kilograms</ORIGINALNAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT></TALLYMESSAGE>
  <TALLYMESSAGE>
   <STOCKITEM NAME="TMT Bar 12mm"><BASEUNITS>Kgs</BASEUNITS><OPENINGBALANCE> 500 Kgs</OPENINGBALANCE><OPENINGRATE>58.00/Kgs</OPENINGRATE>
    <GSTDETAILS.LIST><HSNCODE>7214</HSNCODE><STATEWISEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD><GSTRATE> 18</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST>
   </STOCKITEM>
  </TALLYMESSAGE>
  <TALLYMESSAGE>
   <VOUCHER VCHTYPE="Sales" ACTION="Create"><GUID>guid-sale-1</GUID><DATE>20250415</DATE><VOUCHERNUMBER>T/101</VOUCHERNUMBER><NARRATION>Bars&#4;</NARRATION>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Ravi Stores</LEDGERNAME><AMOUNT>-11800.00</AMOUNT></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>11800.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   </VOUCHER>
  </TALLYMESSAGE>
  <TALLYMESSAGE>
   <VOUCHER VCHTYPE="Receipt"><GUID>guid-rct-1</GUID><DATE>20250420</DATE><VOUCHERNUMBER>R/1</VOUCHERNUMBER>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><AMOUNT>-10000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Ravi Stores</LEDGERNAME><AMOUNT>10000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   </VOUCHER>
  </TALLYMESSAGE>
  <TALLYMESSAGE>
   <VOUCHER VCHTYPE="Payment"><GUID>guid-cancel</GUID><DATE>20250421</DATE><ISCANCELLED>Yes</ISCANCELLED></VOUCHER>
  </TALLYMESSAGE>
  <TALLYMESSAGE>
   <VOUCHER VCHTYPE="Journal"><GUID>guid-missing</GUID><DATE>20250422</DATE><VOUCHERNUMBER>J/9</VOUCHERNUMBER>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Rent</LEDGERNAME><AMOUNT>-5000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><AMOUNT>5000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   </VOUCHER>
  </TALLYMESSAGE>
 </REQUESTDATA></IMPORTDATA></BODY>
</ENVELOPE>`;

/** Tally writes UTF-16 LE with a BOM. */
const utf16 = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]).toString('base64');

beforeAll(async () => {
    await resetDatabase();
    ({ token } = await registerUser('Owner'));
    ({ id: companyId } = await createCompany(token));
});

afterAll(closePool);

describe('Tally import', () => {
    it('previews without saving anything', async () => {
        const r = await api().post('/api/import/tally').set(auth(token)).send({ companyId, fileBase64: utf16(TALLY_XML) });
        expect(r.status).toBe(200);
        expect(r.body.data.dryRun).toBe(true);
        expect(r.body.data.created).toMatchObject({ groups: 1, ledgers: 4, units: 1, items: 1, vouchers: 2 });
        const n = await pool.query(`SELECT COUNT(*)::int n FROM ledgers WHERE company_id = $1 AND name = 'Ravi Stores'`, [companyId]);
        expect(n.rows[0].n).toBe(0);
    });

    it('imports masters, opening balances and vouchers', async () => {
        const r = await api().post('/api/import/tally').set(auth(token)).send({ companyId, fileBase64: utf16(TALLY_XML), commit: true });
        const d = r.body.data;
        expect(d.dryRun).toBe(false);
        expect(d.created).toMatchObject({ groups: 1, units: 1, items: 1, vouchers: 2 });
        expect(d.updated.ledgers).toBe(1); // "Sales" already existed
        expect(d.skipped['vouchers (cancelled/optional)']).toBe(1);
        expect(d.errors.map((e: any) => e.message).join(' ')).toMatch(/Ledger "Rent" not found/);
        expect(d.errors.map((e: any) => e.message).join(' ')).toMatch(/GSTIN 27AAACS1234K1ZX is invalid/);

        const ravi = (await pool.query(`SELECT l.*, g.name AS group_name FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id WHERE l.company_id = $1 AND l.name = 'Ravi Stores'`, [companyId])).rows[0];
        expect(ravi).toMatchObject({ group_name: 'Pune Customers', gstin: '27AAACS1234K1ZH', state: 'Maharashtra', pincode: '411001', address: '12 MG Road, Camp', opening_balance_type: 'Dr', pan: 'AAACS1234K' });
        expect(Number(ravi.opening_balance)).toBe(15000);

        const item = (await pool.query(`SELECT * FROM items WHERE company_id = $1`, [companyId])).rows[0];
        expect(item).toMatchObject({ name: 'TMT Bar 12mm', hsn_code: '7214' });
        expect(Number(item.tax_rate)).toBe(18);
        expect(Number(item.opening_quantity)).toBe(500);

        // Books agree with Tally: Ravi 15000 Dr + 11800 sale - 10000 receipt = 16800 Dr
        const stmt = await api().get(`/api/ledgers/${ravi.id}/statement`).query({ companyId, startDate: '2025-04-01', endDate: '2025-04-30' }).set(auth(token));
        expect(stmt.body.data.ledger).toMatchObject({ closing_balance: 16800, closing_balance_type: 'Dr' });
        const tb = await api().get('/api/reports/trial-balance').query({ companyId, startDate: '2025-04-01', endDate: '2026-03-31' }).set(auth(token));
        expect(tb.body.data.totals.difference).toBe(0);
    });

    it('skips vouchers already imported', async () => {
        const r = await api().post('/api/import/tally').set(auth(token)).send({ companyId, fileBase64: utf16(TALLY_XML), commit: true });
        expect(r.body.data.created.vouchers).toBeUndefined();
        expect(r.body.data.skipped['vouchers (already imported)']).toBe(2);
    });

    it('rejects files that are not Tally exports', async () => {
        const r = await api().post('/api/import/tally').set(auth(token)).send({ companyId, fileBase64: Buffer.from('<x/>').toString('base64') });
        expect(r.status).toBe(400);
    });
});

describe('Excel import', () => {
    it('serves a template and imports parties with row-level errors', async () => {
        const t = await api().get('/api/import/excel/ledgers/template').set(auth(token)).buffer(true).parse((res, cb) => {
            const c: Buffer[] = [];
            res.on('data', (x: Buffer) => c.push(x));
            res.on('end', () => cb(null, Buffer.concat(c)));
        });
        expect(t.status).toBe(200);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(t.body);
        const ws = wb.worksheets[0];
        ws.addRow(['Mehta & Sons', 'Sundry Debtors', '', 'Gujarat', '', '9876500000', '', '', 'Surat', '395001', '2500', 'Dr']);
        ws.addRow(['Broken Party', 'Nonexistent Group']);
        ws.addRow(['Bad GSTIN', 'Sundry Debtors', '27AAACS1234K1ZX']);
        const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');

        const r = await api().post('/api/import/excel/ledgers').set(auth(token)).send({ companyId, fileBase64: file, commit: true });
        // Row 2 is the template's example "Ravi Stores", which the Tally import already created
        expect(r.body.data.created.ledgers).toBe(1);
        expect(r.body.data.errors.map((e: any) => e.ref.split(' ').slice(0, 2).join(' '))).toEqual(['Row 2', 'Row 4', 'Row 5']);
        expect(r.body.data.errors[0].message).toMatch(/already exists/);
        const mehta = (await pool.query(`SELECT * FROM ledgers WHERE company_id = $1 AND name = 'Mehta & Sons'`, [companyId])).rows[0];
        expect(mehta).toMatchObject({ state: 'Gujarat', city: 'Surat', pincode: '395001', opening_balance_type: 'Dr' });
    });

    it('imports items and creates missing units', async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Items');
        ws.addRow(['Name*', 'HSN/SAC', 'Type', 'Unit', 'GST Rate %', 'Sales Rate', 'Purchase Rate', 'Opening Qty']);
        ws.addRow(['Cement Bag', '2523', 'Goods', 'bag', 28, 420, 380, 100]);
        ws.addRow(['Site Supervision', '998719', 'Services', '', 18, 1500, 0, 0]);
        ws.addRow(['Odd Rate', '', 'Goods', '', 150]);
        const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
        const r = await api().post('/api/import/excel/items').set(auth(token)).send({ companyId, fileBase64: file, commit: true });
        expect(r.body.data.created).toMatchObject({ items: 2, units: 1 });
        expect(r.body.data.errors[0].message).toMatch(/GST rate/);
        const svc = (await pool.query(`SELECT item_type FROM items WHERE company_id = $1 AND name = 'Site Supervision'`, [companyId])).rows[0];
        expect(svc.item_type).toBe('SERVICES');
    });

    it('requires the admin role', async () => {
        const { token: other } = await registerUser('Other');
        expect((await api().post('/api/import/tally').set(auth(other)).send({ companyId, fileBase64: 'eA==' })).status).toBe(403);
    });
});
