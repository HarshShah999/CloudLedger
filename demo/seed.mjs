/**
 * Loads a demo company ("Patel Traders") through the API, the same way a user would:
 * Tally masters and Day Book import, then six months of sales, purchases and receipts
 * dated around today, so the dashboard and reports always look current.
 * Safe to run again: it does nothing if the demo login already exists.
 *
 *   API_URL=http://localhost:8000/api node demo/seed.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const API = process.env.API_URL || 'http://localhost:8000/api';
const EMAIL = process.env.DEMO_EMAIL || 'demo@taalmelbooks.in';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';
const here = path.dirname(fileURLToPath(import.meta.url));

const call = async (pathname, { method = 'GET', body, token } = {}) => {
    const r = await fetch(API + pathname, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
};
const must = async (pathname, opts) => {
    const r = await call(pathname, opts);
    if (r.status >= 400) throw new Error(`${pathname}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

const main = async () => {
    for (let i = 0; i < 60; i++) {
        try {
            if ((await fetch(API + '/health/ready')).ok) break;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 2000));
    }
    let token;
    const existing = await call('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
    if (existing.status === 200) {
        token = existing.data.token;
        const companies = (await must('/companies', { token })).data.companies;
        if (companies.length) {
            console.log(`Demo data is already loaded. Open http://localhost:5173 and sign in with ${EMAIL} / ${PASSWORD}`);
            return;
        }
        // A previous run stopped before creating the company: finish the setup
    } else {
        token = (await must('/auth/register', { method: 'POST', body: { name: 'Asha Patel', email: EMAIL, password: PASSWORD } })).token;
    }

    const today = new Date();
    const fyStart = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    const co = await must('/companies', {
        method: 'POST', token,
        body: {
            name: 'Patel Traders', state: 'Maharashtra', gstin: '27ABCDE1234F1Z0', email: 'accounts@pateltraders.in',
            financialYear: { name: `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`, startDate: `${fyStart}-04-01`, endDate: `${fyStart + 1}-03-31` },
        },
    });
    const companyId = co.data.company.id;
    await must(`/companies/${companyId}`, {
        method: 'PUT', token,
        body: {
            companyId, address: '14, Market Yard, Gultekdi', city: 'Pune', pincode: '411037', phone: '9822000000',
            upiId: 'pateltraders@okhdfc', bankName: 'HDFC Bank', bankAccountName: 'Patel Traders', bankAccountNumber: '50200012345678',
            bankIfsc: 'HDFC0000123', bankBranch: 'Market Yard, Pune', invoiceTerms: 'Goods once sold will not be taken back. Interest @18% p.a. after due date.',
        },
    });

    const importXml = async (xml) =>
        (await must('/import/tally', { method: 'POST', token, body: { companyId, fileBase64: Buffer.from(xml).toString('base64'), commit: true } })).data;

    // Tally masters: opening bills dated in the March before the financial year
    const masters = fs.readFileSync(path.join(here, 'sample-tally-masters.xml'), 'utf8').replace(/<BILLDATE>\d{4}03/g, `<BILLDATE>${fyStart}03`);
    console.log('Masters:', JSON.stringify((await importXml(masters)).created));

    // The sample Day Book, moved to last month
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const ym = `${lastMonth.getFullYear()}${pad(lastMonth.getMonth() + 1)}`;
    const daybook = fs.readFileSync(path.join(here, 'sample-tally-daybook.xml'), 'utf8').replace(/<DATE>\d{6}(\d\d)</g, `<DATE>${ym}$1<`);
    console.log('Day Book:', JSON.stringify((await importXml(daybook)).created));

    // Six months of trading
    const msg = [];
    let n = 100;
    const sale = (date, party, qty, inter) => {
        const amt = qty * 65, tax = Math.round(amt * 18) / 100, half = Math.round(amt * 9) / 100, total = Math.round(amt + tax);
        const ro = (total - amt - (inter ? tax : half * 2)).toFixed(2);
        const no = `SG/${n++}`;
        msg.push(`<TALLYMESSAGE><VOUCHER VCHTYPE="Sales GST"><DATE>${date}</DATE><GUID>demo-${no}</GUID><VOUCHERNUMBER>${no}</VOUCHERNUMBER>` +
            `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>TMT Bar 12mm</STOCKITEMNAME><RATE>65.00/kg</RATE><AMOUNT>${amt.toFixed(2)}</AMOUNT><BILLEDQTY>${qty} kg</BILLEDQTY><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales GST 18%</LEDGERNAME><AMOUNT>${amt.toFixed(2)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>` +
            `<LEDGERENTRIES.LIST><LEDGERNAME>${party}</LEDGERNAME><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-${total.toFixed(2)}</AMOUNT><BILLALLOCATIONS.LIST><NAME>${no}</NAME><BILLTYPE>New Ref</BILLTYPE><BILLCREDITPERIOD>30 Days</BILLCREDITPERIOD><AMOUNT>-${total.toFixed(2)}</AMOUNT></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>` +
            (inter ? `<LEDGERENTRIES.LIST><LEDGERNAME>IGST</LEDGERNAME><AMOUNT>${tax.toFixed(2)}</AMOUNT></LEDGERENTRIES.LIST>`
                   : `<LEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><AMOUNT>${half.toFixed(2)}</AMOUNT></LEDGERENTRIES.LIST><LEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><AMOUNT>${half.toFixed(2)}</AMOUNT></LEDGERENTRIES.LIST>`) +
            (Number(ro) ? `<LEDGERENTRIES.LIST><LEDGERNAME>Round Off</LEDGERNAME><AMOUNT>${ro}</AMOUNT></LEDGERENTRIES.LIST>` : '') + `</VOUCHER></TALLYMESSAGE>`);
        return { no, total };
    };
    const todayKey = ymd(today);
    for (let i = 5; i >= 0; i--) {
        const m = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const p = `${m.getFullYear()}${pad(m.getMonth() + 1)}`;
        const q = 450 + (5 - i) * 30, amt = q * 58, half = Math.round(amt * 9) / 100;
        if (`${p}02` <= todayKey) {
            msg.push(`<TALLYMESSAGE><VOUCHER VCHTYPE="Purchase"><DATE>${p}02</DATE><GUID>demo-p-${p}</GUID><VOUCHERNUMBER>P-${p}</VOUCHERNUMBER><REFERENCE>SS-${p}</REFERENCE>` +
                `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>TMT Bar 12mm</STOCKITEMNAME><RATE>58.00/kg</RATE><AMOUNT>-${amt.toFixed(2)}</AMOUNT><BILLEDQTY>${q} kg</BILLEDQTY><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Purchase GST</LEDGERNAME><AMOUNT>-${amt.toFixed(2)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>` +
                `<LEDGERENTRIES.LIST><LEDGERNAME>Shree Steel</LEDGERNAME><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${(amt + 2 * half).toFixed(2)}</AMOUNT></LEDGERENTRIES.LIST>` +
                `<LEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><AMOUNT>-${half.toFixed(2)}</AMOUNT></LEDGERENTRIES.LIST><LEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><AMOUNT>-${half.toFixed(2)}</AMOUNT></LEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>`);
        }
        for (let k = 0; k < 4; k++) {
            const date = `${p}${pad(3 + k * 6)}`;
            if (date > todayKey) continue;
            const party = k % 2 ? 'Mehta Traders' : 'Ravi Stores';
            const s = sale(date, party, 40 + (((5 - i) * 7 + k * 13) % 9) * 15, party === 'Mehta Traders');
            // Older invoices are paid; the most recent ones are still outstanding
            if (i >= 2 || (i === 1 && k < 2)) {
                msg.push(`<TALLYMESSAGE><VOUCHER VCHTYPE="Bank Receipt"><DATE>${p}${pad(5 + k * 6)}</DATE><GUID>demo-r-${s.no}</GUID><VOUCHERNUMBER>R-${s.no}</VOUCHERNUMBER><LEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><AMOUNT>-${s.total.toFixed(2)}</AMOUNT></LEDGERENTRIES.LIST><LEDGERENTRIES.LIST><LEDGERNAME>${party}</LEDGERNAME><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${s.total.toFixed(2)}</AMOUNT><BILLALLOCATIONS.LIST><NAME>${s.no}</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>${s.total.toFixed(2)}</AMOUNT></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>`);
            }
        }
    }
    const trading = await importXml(`<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>${msg.join('')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`);
    console.log('Six months of trading:', JSON.stringify(trading.created));
    console.log(`\nDemo ready. Open http://localhost:5173 and sign in with ${EMAIL} / ${PASSWORD}`);
};

main().catch((e) => {
    console.error('Demo setup failed:', e.message);
    process.exit(1);
});
