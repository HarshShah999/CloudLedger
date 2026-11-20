/**
 * Tally Day Book import.
 *
 * Every Tally voucher is posted to the books exactly as Tally has it (so the
 * Trial Balance matches to the paisa). On top of that:
 *  - Sales / Purchase / Credit Note / Debit Note vouchers (including custom types
 *    such as "Sales GST") are also recorded as GST invoices with their items,
 *    tax split and stock movement, so they appear in the invoice lists, GST
 *    returns, outstanding reports and stock. When a voucher cannot be turned
 *    into a GST invoice safely, it stays in the books only and a warning says why.
 *  - Receipts and payments are linked to the bills they settle (Tally's
 *    "Agst Ref"); without bill references they settle the oldest bills first.
 *  - Opening bill-wise balances of party ledgers become opening bills.
 */
import { PoolClient } from 'pg';
import { fromPaise, toPaise } from '../utils/money';
import { stateCode, stateName } from '../utils/gst';
import { isInterStateSupply } from './invoiceCalc';
import { postVoucher } from './posting';
import { ensureSystemLedger, STANDARD_VOUCHER_TYPES } from './companySetup';
import { refreshInvoicePaymentStatus } from './paymentService';
import { syncInvoiceStock } from './stockService';
import { openInvoices, SETTLES, Direction } from './receiptService';
import { ImportReport, attempt, bump } from './importCommon';
import { addDays, asArray, creditDays, tallyDate, tallyNumber, taxHeadFromName, text, yes } from './tallyXml';

/* ------------------------------------------------------------------ */
/* Voucher types                                                       */
/* ------------------------------------------------------------------ */

/** Tally's built-in voucher types that do not touch the books. */
const NON_ACCOUNTING = new Set([
    'sales order', 'purchase order', 'delivery note', 'receipt note', 'rejections in', 'rejections out',
    'stock journal', 'physical stock', 'memorandum', 'reversing journal', 'attendance', 'material in',
    'material out', 'job work in order', 'job work out order',
]);
const ACCOUNTING = new Map(STANDARD_VOUCHER_TYPES.map((t) => [t.toLowerCase(), t]));
ACCOUNTING.set('payroll', 'Journal');

/** Guess from the name when Tally's voucher type master was not imported. */
const guessBase = (name: string): string | null => {
    const n = name.toLowerCase();
    if (/credit\s*note|sales?\s*return/.test(n)) return 'Credit Note';
    if (/debit\s*note|purchase\s*return/.test(n)) return 'Debit Note';
    if (/purchase\s*order|\bpo\b/.test(n)) return 'purchase order';
    if (/sales?\s*order|\bso\b/.test(n)) return 'sales order';
    if (/delivery|challan/.test(n)) return 'delivery note';
    if (/receipt\s*note|\bgrn\b/.test(n)) return 'receipt note';
    if (/stock\s*journal|manufactur/.test(n)) return 'stock journal';
    if (/memo/.test(n)) return 'memorandum';
    if (/purchase/.test(n)) return 'Purchase';
    if (/sale|invoice|\bbill\b/.test(n)) return 'Sales';
    if (/receipt/.test(n)) return 'Receipt';
    if (/payment/.test(n)) return 'Payment';
    if (/contra/.test(n)) return 'Contra';
    if (/journal/.test(n)) return 'Journal';
    return null;
};

export const resolveBaseType = (name: string, parents: Map<string, string>): { base: string; accounting: boolean } => {
    let current = name.trim();
    for (let i = 0; i < 10 && current; i++) {
        const key = current.toLowerCase();
        if (ACCOUNTING.has(key)) return { base: ACCOUNTING.get(key)!, accounting: true };
        if (NON_ACCOUNTING.has(key)) return { base: current, accounting: false };
        const parent = parents.get(key);
        if (!parent || parent.toLowerCase() === key) break;
        current = parent;
    }
    const guess = guessBase(name);
    if (!guess) return { base: 'Journal', accounting: true };
    return ACCOUNTING.has(guess.toLowerCase()) ? { base: guess, accounting: true } : { base: guess, accounting: false };
};

/** Remembers Tally's voucher types so Day Book files imported later resolve them. */
export const saveVoucherTypes = async (db: PoolClient, companyId: string, voucherTypes: any[], report: ImportReport) => {
    for (const vt of voucherTypes) {
        const name = text(vt?.['@NAME'] ?? vt?.NAME);
        const parent = text(vt?.PARENT);
        if (!name || !parent || name.toLowerCase() === parent.toLowerCase()) continue;
        await db.query(
            `INSERT INTO imported_voucher_types (company_id, name, parent) VALUES ($1, $2, $3)
             ON CONFLICT (company_id, name) DO UPDATE SET parent = EXCLUDED.parent`,
            [companyId, name.toLowerCase().slice(0, 100), parent.slice(0, 100)]
        );
        bump(report.created, 'voucher types');
    }
};

/* ------------------------------------------------------------------ */
/* Ledger lookups                                                      */
/* ------------------------------------------------------------------ */

interface LedgerInfo {
    id: string;
    name: string;
    code: string | null;
    taxHead: string | null;
    groups: Set<string>; // codes of the ledger's group and all its parents
    state: string | null;
    registration: string | null;
}

const loadLedgers = async (db: PoolClient, companyId: string) => {
    const groups = new Map<string, { parent: string | null; code: string | null }>();
    for (const g of (await db.query('SELECT id, parent_id, code FROM ledger_groups WHERE company_id = $1', [companyId])).rows) {
        groups.set(g.id, { parent: g.parent_id, code: g.code });
    }
    const codesOf = (groupId: string | null) => {
        const out = new Set<string>();
        for (let id = groupId, i = 0; id && i < 30; i++) {
            const g = groups.get(id);
            if (!g) break;
            if (g.code) out.add(g.code);
            id = g.parent;
        }
        return out;
    };
    const map = new Map<string, LedgerInfo>();
    const rows = await db.query(
        'SELECT id, name, code, gst_tax_head, group_id, state, gst_registration_type FROM ledgers WHERE company_id = $1',
        [companyId]
    );
    for (const l of rows.rows) {
        map.set(l.name.toLowerCase(), {
            id: l.id, name: l.name, code: l.code, taxHead: l.gst_tax_head, groups: codesOf(l.group_id),
            state: l.state, registration: l.gst_registration_type,
        });
    }
    return map;
};

const headOf = (l: LedgerInfo): string | null => {
    if (l.taxHead) return l.taxHead;
    const sys = /^(?:OUTPUT|INPUT)_(CGST|SGST|IGST)$/.exec(l.code ?? '');
    if (sys) return sys[1];
    return l.groups.has('DUTIES_TAXES') ? taxHeadFromName(l.name) : null;
};
const isRoundOff = (l: LedgerInfo) => l.code === 'ROUND_OFF' || /round/i.test(l.name);
const isTds = (l: LedgerInfo) => l.code === 'TDS_PAYABLE' || /\btds\b/i.test(l.name);
const isPartyGroup = (l: LedgerInfo) => l.groups.has('SUNDRY_DEBTORS') || l.groups.has('SUNDRY_CREDITORS');
const isCashOrBank = (l: LedgerInfo) => l.groups.has('CASH_IN_HAND') || l.groups.has('BANK_ACCOUNTS') || l.groups.has('BANK_OD');

/** One accounting line of a Tally voucher. `paise` is positive for Dr. */
interface Line {
    info: LedgerInfo;
    paise: number;
    node: any;
    fromInventory: boolean;
}

/* ------------------------------------------------------------------ */
/* Sales / purchase vouchers -> GST invoices                           */
/* ------------------------------------------------------------------ */

const DOC_TYPE: Record<string, 'SALES' | 'PURCHASE' | 'CREDIT_NOTE' | 'DEBIT_NOTE'> = {
    Sales: 'SALES', Purchase: 'PURCHASE', 'Credit Note': 'CREDIT_NOTE', 'Debit Note': 'DEBIT_NOTE',
};
const LABEL = { SALES: 'sales invoice', PURCHASE: 'purchase bill', CREDIT_NOTE: 'credit note', DEBIT_NOTE: 'debit note' };
const PARTY_DR = { SALES: true, DEBIT_NOTE: true, PURCHASE: false, CREDIT_NOTE: false };
const SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
const snapRate = (r: number) => SLABS.reduce((best, s) => (Math.abs(s - r) < Math.abs(best - r) ? s : best), 0);

interface Ctx {
    db: PoolClient;
    companyId: string;
    companyState: string | null;
    ledgers: Map<string, LedgerInfo>;
    items: Map<string, { id: string; tax_rate: number }>;
}

/** Splits `total` paise across lines in proportion to `weights`; the rounding remainder goes to the largest line. */
const split = (total: number, weights: number[]): number[] => {
    const sum = weights.reduce((s, w) => s + w, 0);
    if (!total || !sum) return weights.map(() => 0);
    const out = weights.map((w) => Math.floor(total * (w / sum)));
    out[weights.indexOf(Math.max(...weights))] += total - out.reduce((s, x) => s + x, 0);
    return out;
};

/**
 * Records a Tally sales/purchase voucher as a GST invoice linked to the voucher
 * that was already posted. Returns null on success or the reason it could not.
 */
const recordInvoice = async (
    ctx: Ctx,
    v: any,
    base: string,
    date: string,
    voucher: { id: string; financial_year_id: string },
    ledgerLines: Line[],
    allocLines: Line[],
    inventory: any[]
): Promise<string | null> => {
    const type = DOC_TYPE[base];
    const partyDr = PARTY_DR[type];
    const onPartySide = (l: Line) => (partyDr ? l.paise > 0 : l.paise < 0);
    const abs = (l: Line) => Math.abs(l.paise);

    // The party: flagged by Tally, named on the voucher, carrying bill references, or the only candidate
    const partyName = text(v.PARTYLEDGERNAME).toLowerCase();
    let party =
        ledgerLines.find((l) => yes(l.node.ISPARTYLEDGER)) ??
        ledgerLines.find((l) => partyName && l.info.name.toLowerCase() === partyName) ??
        ledgerLines.find((l) => asArray(l.node['BILLALLOCATIONS.LIST']).length > 0);
    if (!party) {
        const candidates = ledgerLines.filter(
            (l) => onPartySide(l) && !headOf(l.info) && !isRoundOff(l.info) && !(type === 'PURCHASE' && isTds(l.info))
        );
        if (candidates.length === 1) party = candidates[0];
    }
    if (!party) return 'the party could not be identified';
    if (!onPartySide(party)) return `the party is ${partyDr ? 'credited' : 'debited'}, which a ${LABEL[type]} does not do`;

    const heads: Record<string, number> = { CGST: 0, SGST: 0, IGST: 0, CESS: 0 };
    let roundOff = 0;
    let tds = 0;
    const accountLines: Line[] = [];
    const deductions: Line[] = []; // e.g. a discount ledger on the invoice
    for (const l of [...ledgerLines.filter((x) => x !== party), ...allocLines]) {
        if (!l.paise) continue;
        const signed = onPartySide(l) ? -abs(l) : abs(l); // positive = on the sales/purchase side
        const head = headOf(l.info);
        if (head) heads[head] += signed;
        else if (isRoundOff(l.info)) roundOff += signed;
        else if (type === 'PURCHASE' && isTds(l.info) && signed < 0) tds += abs(l);
        else if (signed < 0) {
            if (isPartyGroup(l.info) || isCashOrBank(l.info)) return `it has a second party (${l.info.name})`;
            deductions.push(l);
        }
        else accountLines.push(l);
    }
    if (heads.CESS) return 'it has GST cess, which CloudLedger does not support yet';
    if (heads.CGST < 0 || heads.SGST < 0 || heads.IGST < 0) return 'its GST entries are reversed';
    if (heads.IGST && (heads.CGST || heads.SGST)) return 'it has both IGST and CGST/SGST';
    if (heads.CGST !== heads.SGST && Math.abs(heads.CGST - heads.SGST) > 1) return 'its CGST and SGST differ';
    if (!accountLines.length) return `it has no ${type === 'PURCHASE' || type === 'DEBIT_NOTE' ? 'purchase' : 'sales'} ledger`;

    // Lines: stock items (item invoices) plus any income/expense ledgers such as freight
    type Ln = { itemId: string | null; description: string | null; qty: number; rate: number; taxable: number; discountPct: number; taxRate: number | null; cut?: number };
    const lines: Ln[] = [];
    for (const ie of inventory) {
        const taxable = Math.abs(toPaise(tallyNumber(ie.AMOUNT)));
        if (!taxable) continue;
        const name = text(ie.STOCKITEMNAME);
        const item = ctx.items.get(name.toLowerCase());
        const qty = Math.abs(tallyNumber(ie.BILLEDQTY || ie.ACTUALQTY)) || 1;
        const rate = Math.abs(tallyNumber(ie.RATE)) || Math.round(taxable / qty) / 100;
        lines.push({
            itemId: item?.id ?? null, description: item ? null : name || 'Item', qty, rate, taxable,
            discountPct: Math.min(Math.max(tallyNumber(ie.DISCOUNT), 0), 100), taxRate: item ? Number(item.tax_rate) : null,
        });
    }
    for (const l of accountLines.filter((x) => !x.fromInventory)) {
        lines.push({ itemId: null, description: l.info.name, qty: 1, rate: fromPaise(abs(l)), taxable: abs(l), discountPct: 0, taxRate: null });
    }
    if (!lines.length) return 'it has no items';

    // A discount ledger reduces the taxable value, shared across the lines by value
    const deducted = deductions.reduce((s, l) => s + abs(l), 0);
    if (deducted) {
        const cuts = split(deducted, lines.map((l) => l.taxable));
        lines.forEach((l, i) => {
            l.cut = cuts[i];
            l.taxable -= cuts[i];
        });
        if (lines.some((l) => l.taxable <= 0)) return `its discount (${deductions[0].info.name}) is larger than the items`;
    }

    const partyP = abs(party);
    const taxable = lines.reduce((s, l) => s + l.taxable, 0);
    const tax = heads.CGST + heads.SGST + heads.IGST;
    if (taxable + tax + roundOff !== partyP + tds) {
        return `its items (₹${fromPaise(taxable).toFixed(2)}) and taxes do not add up to the party amount (₹${fromPaise(partyP).toFixed(2)})`;
    }

    // Supply type and place of supply
    const salesSide = type !== 'PURCHASE';
    const reg = party.info.registration;
    let supply = 'NORMAL';
    if (salesSide && reg === 'OVERSEAS') supply = tax ? 'EXPORT_WPAY' : 'EXPORT_WOPAY';
    if (salesSide && reg === 'SEZ') supply = tax ? 'SEZ_WPAY' : 'SEZ_WOPAY';
    const rawPos = text(v.PLACEOFSUPPLY) || (supply.startsWith('EXPORT') ? '96' : party.info.state || ctx.companyState);
    const placeOfSupply = rawPos ? stateName(stateCode(rawPos)) ?? rawPos : null;
    const inter = heads.IGST > 0 || supply !== 'NORMAL' || (!tax && isInterStateSupply(ctx.companyState, placeOfSupply));

    // GST rate per line: from the item master, else the voucher's effective rate; must reproduce Tally's tax
    let rates: number[] | null;
    if (!tax) {
        rates = lines.map((l) => (supply.endsWith('WOPAY') ? l.taxRate ?? 0 : 0));
    } else {
        const effective = snapRate((tax / taxable) * 100);
        const tolerance = 100 * (lines.length + 1);
        const fits = (rs: number[]) => Math.abs(lines.reduce((s, l, i) => s + Math.round((l.taxable * rs[i]) / 100), 0) - tax) <= tolerance;
        const fromItems = lines.map((l) => l.taxRate ?? effective);
        const uniform = lines.map(() => effective);
        rates = fits(fromItems) ? fromItems : fits(uniform) ? uniform : null;
    }
    if (!rates) {
        return deducted
            ? `its discount (${deductions[0].info.name}) seems to be given after tax, which a GST invoice cannot show`
            : 'the GST rate of its items could not be worked out';
    }
    const weights = lines.map((l, i) => l.taxable * rates![i]);
    const cg = split(heads.CGST, weights);
    const sg = split(heads.SGST, weights);
    const ig = split(heads.IGST, weights);

    // Number: our own for sales-side documents, the supplier's bill number for purchases
    const number = ((type === 'PURCHASE' ? text(v.REFERENCE) : '') || text(v.VOUCHERNUMBER)).slice(0, 50);
    if (!number) return 'it has no voucher number';
    const dup = await ctx.db.query(
        `SELECT 1 FROM invoices WHERE company_id = $1 AND type = $2 AND financial_year_id = $3 AND NOT is_opening
         AND lower(invoice_number) = lower($4) AND ($2 <> 'PURCHASE' OR party_ledger_id = $5)`,
        [ctx.companyId, type, voucher.financial_year_id, number, party.info.id]
    );
    if (dup.rows.length) return `number ${number} is already used by another ${LABEL[type]} this year`;

    const bills = asArray(party.node['BILLALLOCATIONS.LIST']);
    const newRef = bills.find((b: any) => /new/i.test(text(b.BILLTYPE))) ?? bills[0];
    const against = bills.find((b: any) => /agst/i.test(text(b.BILLTYPE)));
    const days = creditDays(newRef?.BILLCREDITPERIOD);
    const salesLedger = accountLines.reduce((a, b) => (abs(b) > abs(a) ? b : a));
    const grand = taxable + tax + roundOff;

    const inv = (
        await ctx.db.query(
            `INSERT INTO invoices (
                company_id, voucher_id, party_ledger_id, sales_ledger_id, invoice_number, date, due_date, type,
                subtotal, tax_total, grand_total, notes, discount_percent, discount_amount, paid_amount,
                outstanding_amount, payment_status, original_invoice_number, financial_year_id, place_of_supply,
                round_off, supply_type, reverse_charge, tds_rate, tds_amount, bill_ref
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,0,0,$13,'UNPAID',$14,$15,$16,$17,$18,false,$19,$20,$21)
            RETURNING id`,
            [
                ctx.companyId, voucher.id, party.info.id, salesLedger.info.id, number, date,
                days != null ? addDays(date, days) : null, type, fromPaise(taxable), fromPaise(tax), fromPaise(grand),
                text(v.NARRATION) || null, fromPaise(partyP),
                against && (type === 'CREDIT_NOTE' || type === 'DEBIT_NOTE') ? text(against.NAME).slice(0, 50) || null : null,
                voucher.financial_year_id, placeOfSupply, fromPaise(roundOff), supply,
                tds ? Math.round((tds / taxable) * 100000) / 1000 : 0, fromPaise(tds),
                (text(newRef?.NAME) || number).slice(0, 100),
            ]
        )
    ).rows[0];

    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const gross = Math.max(Math.round(l.qty * l.rate * 100), l.taxable + (l.cut ?? 0));
        const lineTax = cg[i] + sg[i] + ig[i];
        await ctx.db.query(
            `INSERT INTO invoice_items (
                invoice_id, item_id, description, quantity, rate, amount, discount_percent, discount_amount,
                taxable_amount, tax_rate, tax_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
                igst_rate, igst_amount, total_amount
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [
                inv.id, l.itemId, l.description, l.qty, l.rate, fromPaise(gross), l.discountPct, fromPaise(gross - l.taxable),
                fromPaise(l.taxable), rates[i], fromPaise(lineTax), inter ? 0 : rates[i] / 2, fromPaise(cg[i]),
                inter ? 0 : rates[i] / 2, fromPaise(sg[i]), inter ? rates[i] : 0, fromPaise(ig[i]), fromPaise(l.taxable + lineTax),
            ]
        );
    }
    await syncInvoiceStock(ctx.db, inv.id);
    return null;
};

/* ------------------------------------------------------------------ */
/* Receipts / payments -> bill-wise settlement                         */
/* ------------------------------------------------------------------ */

const allocate = async (db: PoolClient, companyId: string, receipt: any, invoiceId: string, amountP: number) => {
    await db.query(
        `INSERT INTO payments (company_id, invoice_id, receipt_id, payment_date, amount, payment_mode, reference_number, notes, deposit_ledger_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [companyId, invoiceId, receipt.id, receipt.date, fromPaise(amountP), receipt.payment_mode, receipt.reference_number, receipt.notes, receipt.deposit_ledger_id]
    );
    await refreshInvoicePaymentStatus(db, invoiceId);
};

/** Links a simple receipt/payment (one party, one cash/bank account) to the bills it settles. */
const linkReceipt = async (ctx: Ctx, v: any, ref: string, date: string, voucherId: string, ledgerLines: Line[], report: ImportReport) => {
    const nonZero = ledgerLines.filter((l) => l.paise);
    const party = nonZero.find((l) => asArray(l.node['BILLALLOCATIONS.LIST']).length || yes(l.node.ISPARTYLEDGER) || isPartyGroup(l.info));
    if (!party) return;
    const others = nonZero.filter((l) => l !== party);
    if (others.length !== 1 || !isCashOrBank(others[0].info) || Math.abs(others[0].paise) !== Math.abs(party.paise)) {
        bump(report.skipped, 'bill-wise links (receipts/payments with several parties or charges)');
        return;
    }
    const direction: Direction = party.paise < 0 ? 'RECEIPT' : 'PAYMENT';
    const amountP = Math.abs(party.paise);
    const receipt = (
        await ctx.db.query(
            `INSERT INTO receipts (company_id, party_ledger_id, direction, date, amount, deposit_ledger_id, payment_mode, reference_number, notes, voucher_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [
                ctx.companyId, party.info.id, direction, date, fromPaise(amountP), others[0].info.id,
                isCashOrBank(others[0].info) && others[0].info.groups.has('CASH_IN_HAND') ? 'Cash' : 'Bank',
                text(v.REFERENCE).slice(0, 100) || null, text(v.NARRATION) || null, voucherId,
            ]
        )
    ).rows[0];

    let remaining = amountP;
    const bills = asArray(party.node['BILLALLOCATIONS.LIST']);
    const against = bills.filter((b: any) => /agst/i.test(text(b.BILLTYPE)));
    if (against.length) {
        for (const b of against) {
            const name = text(b.NAME);
            const want = Math.min(Math.abs(toPaise(tallyNumber(b.AMOUNT))), remaining);
            if (!want) continue;
            const inv = (
                await ctx.db.query(
                    `SELECT i.id, i.grand_total - i.tds_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS outstanding
                     FROM invoices i
                     WHERE i.company_id = $1 AND i.party_ledger_id = $2 AND i.type = ANY($3)
                       AND (lower(i.bill_ref) = lower($4) OR lower(i.invoice_number) = lower($4))
                     ORDER BY i.date LIMIT 1`,
                    [ctx.companyId, party.info.id, SETTLES[direction], name]
                )
            ).rows[0];
            const outstanding = inv ? toPaise(inv.outstanding) : 0;
            if (outstanding <= 0) {
                report.warnings.push({ ref, message: `Bill "${name}" was not found or is already settled; ₹${fromPaise(want).toFixed(2)} is kept as an advance` });
                continue;
            }
            const amt = Math.min(want, outstanding);
            await allocate(ctx.db, ctx.companyId, receipt, inv.id, amt);
            remaining -= amt;
        }
    } else if (!bills.length) {
        // Bill-wise was off in Tally: settle the oldest bills first, as Tally's ledger balance implies
        for (const inv of await openInvoices(ctx.db, ctx.companyId, party.info.id, direction)) {
            if (remaining <= 0) break;
            const amt = Math.min(remaining, toPaise(inv.outstanding));
            if (amt <= 0) continue;
            await allocate(ctx.db, ctx.companyId, receipt, inv.id, amt);
            remaining -= amt;
        }
    }
    bump(report.created, direction === 'RECEIPT' ? 'receipts (bill-wise)' : 'payments (bill-wise)');
};

/* ------------------------------------------------------------------ */
/* Day Book                                                            */
/* ------------------------------------------------------------------ */

export const importTallyVouchers = async (
    db: PoolClient,
    companyId: string,
    vouchers: any[],
    report: ImportReport,
    onProgress?: (done: number, total: number) => void
) => {
    if (!vouchers.length) return;
    const parents = new Map<string, string>();
    for (const r of (await db.query('SELECT name, parent FROM imported_voucher_types WHERE company_id = $1', [companyId])).rows) {
        parents.set(r.name.toLowerCase(), r.parent);
    }
    const ctx: Ctx = {
        db,
        companyId,
        companyState: (await db.query('SELECT state FROM companies WHERE id = $1', [companyId])).rows[0]?.state ?? null,
        ledgers: await loadLedgers(db, companyId),
        items: new Map(
            (await db.query('SELECT id, name, tax_rate FROM items WHERE company_id = $1', [companyId])).rows.map((i) => [i.name.toLowerCase(), i])
        ),
    };

    for (const [index, v] of vouchers.entries()) {
        onProgress?.(index, vouchers.length);
        const vType = text(v['@VCHTYPE'] || v.VOUCHERTYPENAME);
        const number = text(v.VOUCHERNUMBER);
        const ref = `${vType} ${number || ''} ${text(v.DATE)}`.trim();
        if (yes(v.ISCANCELLED) || yes(v.ISOPTIONAL) || yes(v.ISDELETED)) {
            bump(report.skipped, 'vouchers (cancelled/optional)');
            continue;
        }
        const { base, accounting } = resolveBaseType(vType, parents);
        if (!accounting) {
            bump(report.skipped, 'orders, delivery notes and other non-accounting vouchers');
            continue;
        }
        const guid = text(v.GUID) || null;
        await attempt(db, report, ref, async () => {
            if (guid) {
                const dup = await db.query('SELECT 1 FROM vouchers WHERE company_id = $1 AND external_id = $2', [companyId, guid]);
                if (dup.rows.length) return void bump(report.skipped, 'vouchers (already imported)');
            }
            const date = tallyDate(v.DATE);
            if (!date) throw new Error('Missing date');

            const toLine = (e: any, fromInventory: boolean): Line => {
                const name = text(e.LEDGERNAME);
                const info = ctx.ledgers.get(name.toLowerCase());
                if (!info) throw new Error(`Ledger "${name}" not found (import masters first)`);
                return { info, paise: -toPaise(tallyNumber(e.AMOUNT)), node: e, fromInventory }; // Tally: negative = Dr
            };
            const ledgerLines = [...asArray(v['ALLLEDGERENTRIES.LIST']), ...asArray(v['LEDGERENTRIES.LIST'])].map((e) => toLine(e, false));
            const inventory = [...asArray(v['ALLINVENTORYENTRIES.LIST']), ...asArray(v['INVENTORYENTRIES.LIST'])];
            // In item invoices the sales/purchase ledger sits inside each stock line
            const allocLines = inventory.flatMap((ie: any) => asArray(ie['ACCOUNTINGALLOCATIONS.LIST']).map((a) => toLine(a, true)));
            const entries = [...ledgerLines, ...allocLines]
                .filter((l) => l.paise)
                .map((l) => ({ ledgerId: l.info.id, amount: fromPaise(Math.abs(l.paise)), type: (l.paise > 0 ? 'Dr' : 'Cr') as 'Dr' | 'Cr' }));
            if (!entries.length) return void bump(report.skipped, 'vouchers with no accounting entries');

            const voucher = await postVoucher(db, {
                companyId, voucherTypeName: base, voucherNumber: number || null, date,
                narration: text(v.NARRATION) || `Imported from Tally (${vType})`, entries,
            });
            await db.query('UPDATE vouchers SET external_id = $1 WHERE id = $2', [guid, voucher.id]);
            bump(report.created, 'vouchers');

            if (DOC_TYPE[base]) {
                await db.query('SAVEPOINT inv');
                let reason: string | null;
                try {
                    reason = await recordInvoice(ctx, v, base, date, voucher, ledgerLines, allocLines, inventory);
                } catch (e) {
                    reason = (e as Error).message;
                }
                if (reason) {
                    await db.query('ROLLBACK TO SAVEPOINT inv');
                    report.warnings.push({ ref, message: `Imported to the books, but not as a GST ${LABEL[DOC_TYPE[base]]}: ${reason}` });
                } else {
                    await db.query('RELEASE SAVEPOINT inv');
                    bump(report.created, `${LABEL[DOC_TYPE[base]]}s`);
                }
            } else if (base === 'Receipt' || base === 'Payment') {
                await linkReceipt(ctx, v, ref, date, voucher.id, ledgerLines, report);
            }
        });
    }
};

/* ------------------------------------------------------------------ */
/* Opening bill-wise balances                                          */
/* ------------------------------------------------------------------ */

/**
 * Tally keeps a party's opening balance bill by bill. Each unpaid bill becomes an
 * opening bill: it shows in outstanding/ageing and can be settled by receipts,
 * but posts nothing (the amount is already in the ledger's opening balance).
 */
export const importOpeningBills = async (db: PoolClient, companyId: string, ledgerId: string, ledgerNode: any, report: ImportReport) => {
    const bills = asArray(ledgerNode['BILLALLOCATIONS.LIST']).filter((b: any) => tallyNumber(b.OPENINGBALANCE));
    if (!bills.length) return;
    const codes = new Set<string>(
        (
            await db.query(
                `WITH RECURSIVE g AS (
                    SELECT id, parent_id, code FROM ledger_groups WHERE id = (SELECT group_id FROM ledgers WHERE id = $1)
                    UNION ALL SELECT p.id, p.parent_id, p.code FROM ledger_groups p JOIN g ON p.id = g.parent_id
                 ) SELECT code FROM g WHERE code IS NOT NULL`,
                [ledgerId]
            )
        ).rows.map((r) => r.code)
    );
    const debtor = codes.has('SUNDRY_DEBTORS');
    const creditor = codes.has('SUNDRY_CREDITORS');
    const booksStart =
        (await db.query(`SELECT to_char(MIN(start_date), 'YYYY-MM-DD') AS d FROM financial_years WHERE company_id = $1`, [companyId])).rows[0]?.d ??
        new Date().toISOString().slice(0, 10);

    for (const b of bills) {
        const amount = tallyNumber(b.OPENINGBALANCE); // negative = Dr: the party owes us
        const name = (text(b.NAME) || 'Opening').slice(0, 50);
        const type = amount < 0 ? (creditor ? 'DEBIT_NOTE' : 'SALES') : debtor ? 'CREDIT_NOTE' : 'PURCHASE';
        const exists = await db.query(
            'SELECT 1 FROM invoices WHERE company_id = $1 AND party_ledger_id = $2 AND is_opening AND lower(bill_ref) = lower($3)',
            [companyId, ledgerId, name]
        );
        if (exists.rows.length) {
            bump(report.skipped, 'opening bills (already imported)');
            continue;
        }
        const date = tallyDate(b.BILLDATE) ?? booksStart;
        const days = creditDays(b.BILLCREDITPERIOD);
        const value = fromPaise(Math.abs(toPaise(amount)));
        const accountLedger = await ensureSystemLedger(db, companyId, type === 'SALES' || type === 'CREDIT_NOTE' ? 'SALES' : 'PURCHASE');
        await db.query(
            `INSERT INTO invoices (company_id, party_ledger_id, sales_ledger_id, invoice_number, date, due_date, type,
                                   subtotal, tax_total, grand_total, paid_amount, outstanding_amount, payment_status,
                                   is_opening, bill_ref, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$8,0,$8,'UNPAID',true,$4,'Opening balance brought forward')`,
            [companyId, ledgerId, accountLedger, name, date, days != null ? addDays(date, days) : null, type, value]
        );
        bump(report.created, 'opening bills');
    }
};
