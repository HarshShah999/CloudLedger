import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';
import { PoolClient } from 'pg';
import { withTransaction } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { toPaise, fromPaise } from '../utils/money';
import { stateName, uqcFor, validateGstin } from '../utils/gst';
import { postVoucher } from './posting';
import { STANDARD_VOUCHER_TYPES } from './companySetup';

export interface ImportReport {
    dryRun: boolean;
    created: Record<string, number>;
    updated: Record<string, number>;
    skipped: Record<string, number>;
    errors: { ref: string; message: string }[];
}

const newReport = (dryRun: boolean): ImportReport => ({ dryRun, created: {}, updated: {}, skipped: {}, errors: [] });
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

class DryRunRollback extends Error {}

/**
 * Runs an import in one transaction. In dry-run mode everything is executed and
 * then rolled back, so the report shows exactly what a real import would do.
 */
const runImport = async (dryRun: boolean, fn: (db: PoolClient, report: ImportReport) => Promise<void>) => {
    const report = newReport(dryRun);
    try {
        await withTransaction(async (db) => {
            await fn(db, report);
            if (dryRun) throw new DryRunRollback();
        });
    } catch (e) {
        if (!(e instanceof DryRunRollback)) throw e;
    }
    report.errors = report.errors.slice(0, 200);
    return report;
};

/** Each row/voucher in its own savepoint: one bad record does not abort the rest. */
const attempt = async (db: PoolClient, report: ImportReport, ref: string, fn: () => Promise<void>) => {
    await db.query('SAVEPOINT imp');
    try {
        await fn();
        await db.query('RELEASE SAVEPOINT imp');
    } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT imp');
        report.errors.push({ ref, message: (e as Error).message });
    }
};

/* ------------------------------------------------------------------ */
/* Tally XML                                                           */
/* ------------------------------------------------------------------ */

/** Tally exports are often UTF-16 and contain control-character references the XML spec forbids. */
export const decodeTallyFile = (buf: Buffer) => {
    let text: string;
    if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le');
    else if (buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
    else if (buf.length > 3 && buf[1] === 0 && buf[3] === 0) text = buf.toString('utf16le');
    else text = buf.toString('utf8').replace(/^﻿/, '');
    return text.replace(/&#(?:[0-8]|1[124-9]|2\d|3[01]);/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
};

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: any): string => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v)).trim();

/** Finds the first value for `key` anywhere inside `node` (Tally nests GST details in many shapes). */
const deepFind = (node: any, key: string): any => {
    if (!node || typeof node !== 'object') return undefined;
    if (key in node) return node[key];
    for (const v of Object.values(node)) {
        const found = Array.isArray(v) ? v.map((x) => deepFind(x, key)).find((x) => x !== undefined) : deepFind(v, key);
        if (found !== undefined) return found;
    }
    return undefined;
};

/** "-1,250.00" -> -1250 ; "100 Kgs" -> 100 */
const tallyNumber = (v: any) => {
    const m = /-?[\d,]*\.?\d+/.exec(text(v));
    return m ? Number(m[0].replace(/,/g, '')) : 0;
};

const tallyDate = (v: any) => {
    const d = text(v);
    return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
};

const yes = (v: any) => /^yes$/i.test(text(v));

/** Tally's reserved group names mapped to ours (most are identical). */
const TALLY_GROUP_ALIASES: Record<string, string> = {
    'bank occ a/c': 'Bank OD A/c',
    'loans & advances (asset)': 'Loans & Advances (Asset)',
};

/** Nature of a primary group from Tally's flags. */
const natureOf = (g: any): 'Asset' | 'Liability' | 'Income' | 'Expense' => {
    const revenue = yes(g.ISREVENUE);
    const positive = yes(g.ISDEEMEDPOSITIVE);
    if (revenue) return positive ? 'Expense' : 'Income';
    return positive ? 'Asset' : 'Liability';
};

export const parseTallyXml = (xml: string) => {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, trimValues: true });
    let doc: any;
    try {
        doc = parser.parse(xml);
    } catch (e) {
        throw new AppError(`Could not read the Tally XML: ${(e as Error).message}`, 400);
    }
    const messages = asArray(deepFind(doc, 'TALLYMESSAGE'));
    if (!messages.length) throw new AppError('No Tally data found. Export from Tally: Gateway → Export → Masters / Day Book, format XML.', 400);
    const pick = (tag: string) => messages.flatMap((m: any) => asArray(m?.[tag]));
    return { groups: pick('GROUP'), ledgers: pick('LEDGER'), units: pick('UNIT'), items: pick('STOCKITEM'), vouchers: pick('VOUCHER') };
};

const nameOf = (node: any) => text(node?.['@NAME'] ?? node?.NAME ?? deepFind(node?.['LANGUAGENAME.LIST'], 'NAME'));

export const importTally = async (companyId: string, file: Buffer, dryRun: boolean) => {
    const data = parseTallyXml(decodeTallyFile(file));

    return runImport(dryRun, async (db, report) => {
        const groupIds = new Map<string, { id: string; type: string }>();
        const loadGroups = async () => {
            groupIds.clear();
            for (const g of (await db.query('SELECT id, name, type FROM ledger_groups WHERE company_id = $1', [companyId])).rows) {
                groupIds.set(g.name.toLowerCase(), { id: g.id, type: g.type });
            }
        };
        await loadGroups();
        const findGroup = (name: string) => groupIds.get((TALLY_GROUP_ALIASES[name.toLowerCase()] ?? name).toLowerCase());

        // Groups: create missing ones, parents before children
        let pending = data.groups.filter((g: any) => !findGroup(nameOf(g)));
        for (let pass = 0; pass < 10 && pending.length; pass++) {
            const next: any[] = [];
            for (const g of pending) {
                const name = nameOf(g);
                const parentName = text(g.PARENT);
                const parent = parentName ? findGroup(parentName) : undefined;
                if (parentName && !parent) {
                    next.push(g);
                    continue;
                }
                await attempt(db, report, `Group ${name}`, async () => {
                    const type = parent ? parent.type : natureOf(g);
                    const r = await db.query(
                        'INSERT INTO ledger_groups (company_id, name, parent_id, type) VALUES ($1, $2, $3, $4) RETURNING id',
                        [companyId, name, parent?.id ?? null, type]
                    );
                    groupIds.set(name.toLowerCase(), { id: r.rows[0].id, type });
                    bump(report.created, 'groups');
                });
            }
            pending = next;
        }
        for (const g of pending) report.errors.push({ ref: `Group ${nameOf(g)}`, message: `Parent group "${text(g.PARENT)}" not found` });

        // Ledgers (upsert by name)
        for (const l of data.ledgers) {
            const name = nameOf(l);
            if (!name || /^profit & loss a\/c$/i.test(name)) continue;
            await attempt(db, report, `Ledger ${name}`, async () => {
                const group = findGroup(text(l.PARENT));
                if (!group) throw new Error(`Group "${text(l.PARENT)}" not found`);
                const ob = tallyNumber(l.OPENINGBALANCE); // Tally: negative = debit
                let gstin = text(l.PARTYGSTIN || deepFind(l['LEDGSTREGDETAILS.LIST'], 'GSTIN')).toUpperCase() || null;
                if (gstin && !validateGstin(gstin).valid) {
                    report.errors.push({ ref: `Ledger ${name}`, message: `GSTIN ${gstin} is invalid and was not imported` });
                    gstin = null;
                }
                const state = text(l.LEDSTATENAME || l.STATENAME || deepFind(l['LEDMAILINGDETAILS.LIST'], 'STATE')) ||
                    (gstin ? stateName(gstin.slice(0, 2)) : null);
                const address = asArray(deepFind(l, 'ADDRESS')).map(text).filter(Boolean).join(', ') || null;
                const values = [
                    group.id, Math.abs(ob), ob < 0 ? 'Dr' : 'Cr', gstin, state || null,
                    text(l.EMAIL) || null, text(l.LEDGERMOBILE || l.LEDGERPHONE) || null, address,
                    text(l.PINCODE || deepFind(l['LEDMAILINGDETAILS.LIST'], 'PINCODE')) || null,
                    text(l.INCOMETAXNUMBER).toUpperCase() || (gstin ? gstin.slice(2, 12) : null),
                    gstin ? 'REGULAR' : null,
                ];
                const existing = await db.query('SELECT id FROM ledgers WHERE company_id = $1 AND lower(name) = lower($2)', [companyId, name]);
                if (existing.rows.length) {
                    await db.query(
                        `UPDATE ledgers SET group_id = $1, opening_balance = $2, opening_balance_type = $3,
                             gstin = COALESCE($4, gstin), state = COALESCE($5, state), email = COALESCE($6, email),
                             phone = COALESCE($7, phone), address = COALESCE($8, address), pincode = COALESCE($9, pincode),
                             pan = COALESCE($10, pan), gst_registration_type = COALESCE($11, gst_registration_type)
                         WHERE id = $12`,
                        [...values, existing.rows[0].id]
                    );
                    bump(report.updated, 'ledgers');
                } else {
                    await db.query(
                        `INSERT INTO ledgers (company_id, name, group_id, opening_balance, opening_balance_type, gstin, state,
                                              email, phone, address, pincode, pan, gst_registration_type)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                        [companyId, name, ...values]
                    );
                    bump(report.created, 'ledgers');
                }
            });
        }

        // Units and stock items
        const unitIds = new Map<string, string>();
        for (const u of (await db.query('SELECT id, symbol FROM units WHERE company_id = $1', [companyId])).rows) unitIds.set(u.symbol.toLowerCase(), u.id);
        for (const u of data.units) {
            const symbol = nameOf(u);
            // Compound units ("Box of 10 Pcs") are skipped; items use simple base units
            if (!symbol || unitIds.has(symbol.toLowerCase()) || /^no$/i.test(text(u.ISSIMPLEUNIT))) continue;
            await attempt(db, report, `Unit ${symbol}`, async () => {
                const r = await db.query('INSERT INTO units (company_id, name, symbol, uqc) VALUES ($1, $2, $3, $4) RETURNING id', [
                    companyId, text(u.ORIGINALNAME) || symbol, symbol.slice(0, 20), uqcFor(text(u.GSTREPUOM).split('-')[0] || null, symbol),
                ]);
                unitIds.set(symbol.toLowerCase(), r.rows[0].id);
                bump(report.created, 'units');
            });
        }
        for (const it of data.items) {
            const name = nameOf(it);
            if (!name) continue;
            await attempt(db, report, `Item ${name}`, async () => {
                const exists = await db.query('SELECT 1 FROM items WHERE company_id = $1 AND lower(name) = lower($2)', [companyId, name]);
                if (exists.rows.length) return void bump(report.skipped, 'items (already exist)');
                const hsn = text(deepFind(it, 'HSNCODE')) || null;
                const rates = asArray(deepFind(it, 'RATEDETAILS.LIST'));
                const igst = rates.find((r: any) => /integrated|igst/i.test(text(r.GSTRATEDUTYHEAD)));
                const taxRate = igst ? tallyNumber(igst.GSTRATE) : tallyNumber(deepFind(it, 'GSTRATE'));
                const qty = Math.abs(tallyNumber(it.OPENINGBALANCE));
                await db.query(
                    `INSERT INTO items (company_id, name, hsn_code, unit_id, tax_rate, opening_quantity, current_quantity, purchase_rate, item_type)
                     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8)`,
                    [companyId, name, hsn, unitIds.get(text(it.BASEUNITS).toLowerCase()) ?? null, taxRate, qty,
                        Math.abs(tallyNumber(it.OPENINGRATE)), hsn?.startsWith('99') ? 'SERVICES' : 'GOODS']
                );
                bump(report.created, 'items');
            });
        }

        // Vouchers -> balanced vouchers in the books
        const ledgerIds = new Map<string, string>();
        for (const l of (await db.query('SELECT id, name FROM ledgers WHERE company_id = $1', [companyId])).rows) ledgerIds.set(l.name.toLowerCase(), l.id);
        for (const v of data.vouchers) {
            const vType = text(v['@VCHTYPE'] || v.VOUCHERTYPENAME);
            const number = text(v.VOUCHERNUMBER);
            const ref = `${vType} ${number || ''} ${text(v.DATE)}`.trim();
            if (yes(v.ISCANCELLED) || yes(v.ISOPTIONAL) || yes(v.ISDELETED)) {
                bump(report.skipped, 'vouchers (cancelled/optional)');
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
                const lines = [...asArray(v['ALLLEDGERENTRIES.LIST']), ...asArray(v['LEDGERENTRIES.LIST'])];
                const entries = lines
                    .map((e: any) => {
                        const ledger = text(e.LEDGERNAME);
                        const amount = tallyNumber(e.AMOUNT);
                        const id = ledgerIds.get(ledger.toLowerCase());
                        if (!id) throw new Error(`Ledger "${ledger}" not found (import masters first)`);
                        return { ledgerId: id, amount: fromPaise(Math.abs(toPaise(amount))), type: (amount < 0 ? 'Dr' : 'Cr') as 'Dr' | 'Cr' };
                    })
                    .filter((e) => e.amount > 0);
                const voucherTypeName = STANDARD_VOUCHER_TYPES.find((t) => t.toLowerCase() === vType.toLowerCase()) ?? 'Journal';
                const voucher = await postVoucher(db, {
                    companyId, voucherTypeName, voucherNumber: number || null, date,
                    narration: text(v.NARRATION) || `Imported from Tally (${vType})`, entries,
                });
                if (guid) await db.query('UPDATE vouchers SET external_id = $1 WHERE id = $2', [guid, voucher.id]);
                bump(report.created, 'vouchers');
            });
        }
    });
};

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */

export type ExcelKind = 'ledgers' | 'items';

const COLUMNS: Record<ExcelKind, { header: string; key: string; width: number; note?: string }[]> = {
    ledgers: [
        { header: 'Name*', key: 'name', width: 30 },
        { header: 'Group*', key: 'group', width: 22, note: 'e.g. Sundry Debtors, Sundry Creditors, Bank Accounts, Indirect Expenses' },
        { header: 'GSTIN', key: 'gstin', width: 18 },
        { header: 'State', key: 'state', width: 16 },
        { header: 'PAN', key: 'pan', width: 12 },
        { header: 'Mobile', key: 'phone', width: 14 },
        { header: 'Email', key: 'email', width: 24 },
        { header: 'Address', key: 'address', width: 30 },
        { header: 'City', key: 'city', width: 14 },
        { header: 'PIN', key: 'pincode', width: 8 },
        { header: 'Opening Balance', key: 'opening', width: 16 },
        { header: 'Dr/Cr', key: 'drcr', width: 7 },
    ],
    items: [
        { header: 'Name*', key: 'name', width: 30 },
        { header: 'HSN/SAC', key: 'hsn', width: 10 },
        { header: 'Type', key: 'type', width: 10, note: 'Goods or Services' },
        { header: 'Unit', key: 'unit', width: 8, note: 'e.g. kg, pcs, nos' },
        { header: 'GST Rate %', key: 'gst', width: 10 },
        { header: 'Sales Rate', key: 'sales', width: 12 },
        { header: 'Purchase Rate', key: 'purchase', width: 13 },
        { header: 'Opening Qty', key: 'qty', width: 12 },
    ],
};

export const excelTemplate = async (kind: ExcelKind): Promise<Buffer> => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(kind === 'ledgers' ? 'Parties & Ledgers' : 'Items');
    ws.columns = COLUMNS[kind].map(({ header, key, width }) => ({ header, key, width }));
    ws.getRow(1).font = { bold: true };
    COLUMNS[kind].forEach((c, i) => {
        if (c.note) ws.getCell(1, i + 1).note = c.note;
    });
    ws.addRow(
        kind === 'ledgers'
            ? { name: 'Ravi Stores', group: 'Sundry Debtors', gstin: '27AAACS1234K1ZH', state: 'Maharashtra', phone: '9876543210', email: 'accounts@ravistores.in', city: 'Pune', pincode: '411001', opening: 15000, drcr: 'Dr' }
            : { name: 'TMT Bar 12mm', hsn: '7214', type: 'Goods', unit: 'kg', gst: 18, sales: 65, purchase: 58, qty: 500 }
    );
    return Buffer.from(await wb.xlsx.writeBuffer());
};

const cellText = (v: ExcelJS.CellValue): string => {
    if (v == null) return '';
    if (typeof v === 'object') {
        if ('text' in (v as any)) return String((v as any).text).trim();
        if ('result' in (v as any)) return String((v as any).result ?? '').trim();
        if ('richText' in (v as any)) return (v as any).richText.map((r: any) => r.text).join('').trim();
    }
    return String(v).trim();
};

export const importExcel = async (companyId: string, kind: ExcelKind, file: Buffer, dryRun: boolean) => {
    const wb = new ExcelJS.Workbook();
    try {
        await wb.xlsx.load(file as any);
    } catch {
        throw new AppError('Could not read the Excel file. Use the .xlsx template.', 400);
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new AppError('The workbook is empty', 400);
    const headers = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => cellText(v).toLowerCase().replace(/\*/g, '').trim());
    const col = (row: ExcelJS.Row, header: string) => {
        const idx = headers.indexOf(header.toLowerCase().replace(/\*/g, ''));
        return idx > 0 ? cellText(row.getCell(idx).value) : '';
    };
    const rows: { n: number; row: ExcelJS.Row }[] = [];
    ws.eachRow((row, n) => n > 1 && rows.push({ n, row }));
    if (!rows.length) throw new AppError('No rows found below the header', 400);

    return runImport(dryRun, async (db, report) => {
        if (kind === 'ledgers') {
            const groups = new Map((await db.query('SELECT id, name FROM ledger_groups WHERE company_id = $1', [companyId])).rows.map((g) => [g.name.toLowerCase(), g.id]));
            for (const { n, row } of rows) {
                const name = col(row, 'Name');
                if (!name) continue;
                await attempt(db, report, `Row ${n} (${name})`, async () => {
                    const groupId = groups.get(col(row, 'Group').toLowerCase());
                    if (!groupId) throw new Error(`Unknown group "${col(row, 'Group')}"`);
                    const gstin = col(row, 'GSTIN').toUpperCase() || null;
                    if (gstin) {
                        const chk = validateGstin(gstin);
                        if (!chk.valid) throw new Error(chk.reason);
                    }
                    const pin = col(row, 'PIN');
                    if (pin && !/^[1-9]\d{5}$/.test(pin)) throw new Error('PIN code must be 6 digits');
                    const opening = Math.abs(Number(col(row, 'Opening Balance').replace(/,/g, '') || 0));
                    if (!Number.isFinite(opening)) throw new Error('Opening balance is not a number');
                    const exists = await db.query('SELECT 1 FROM ledgers WHERE company_id = $1 AND lower(name) = lower($2)', [companyId, name]);
                    if (exists.rows.length) throw new Error('A ledger with this name already exists');
                    await db.query(
                        `INSERT INTO ledgers (company_id, name, group_id, gstin, state, pan, phone, email, address, city, pincode,
                                              opening_balance, opening_balance_type, gst_registration_type)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
                        [
                            companyId, name, groupId, gstin, col(row, 'State') || (gstin ? stateName(gstin.slice(0, 2)) : null),
                            col(row, 'PAN').toUpperCase() || (gstin ? gstin.slice(2, 12) : null), col(row, 'Mobile') || null,
                            col(row, 'Email') || null, col(row, 'Address') || null, col(row, 'City') || null, pin || null,
                            opening, /^cr$/i.test(col(row, 'Dr/Cr')) ? 'Cr' : 'Dr', gstin ? 'REGULAR' : null,
                        ]
                    );
                    bump(report.created, 'ledgers');
                });
            }
            return;
        }

        const units = new Map((await db.query('SELECT id, symbol FROM units WHERE company_id = $1', [companyId])).rows.map((u) => [u.symbol.toLowerCase(), u.id]));
        for (const { n, row } of rows) {
            const name = col(row, 'Name');
            if (!name) continue;
            await attempt(db, report, `Row ${n} (${name})`, async () => {
                const exists = await db.query('SELECT 1 FROM items WHERE company_id = $1 AND lower(name) = lower($2)', [companyId, name]);
                if (exists.rows.length) throw new Error('An item with this name already exists');
                const unit = col(row, 'Unit');
                let unitId: string | null = null;
                if (unit) {
                    unitId = units.get(unit.toLowerCase()) ?? null;
                    if (!unitId) {
                        unitId = (await db.query('INSERT INTO units (company_id, name, symbol, uqc) VALUES ($1, $2, $2, $3) RETURNING id', [companyId, unit, uqcFor(null, unit)])).rows[0].id;
                        units.set(unit.toLowerCase(), unitId!);
                        bump(report.created, 'units');
                    }
                }
                const gst = Number(col(row, 'GST Rate %') || 0);
                if (!Number.isFinite(gst) || gst < 0 || gst > 100) throw new Error('GST rate must be between 0 and 100');
                const num = (h: string) => Number(col(row, h).replace(/,/g, '') || 0);
                await db.query(
                    `INSERT INTO items (company_id, name, hsn_code, item_type, unit_id, tax_rate, sales_rate, purchase_rate, opening_quantity, current_quantity)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
                    [companyId, name, col(row, 'HSN/SAC') || null, /^serv/i.test(col(row, 'Type')) ? 'SERVICES' : 'GOODS', unitId, gst, num('Sales Rate'), num('Purchase Rate'), num('Opening Qty')]
                );
                bump(report.created, 'items');
            });
        }
    });
};
