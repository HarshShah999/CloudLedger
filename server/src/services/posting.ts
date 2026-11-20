import { Queryable } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { fromPaise, toPaise } from '../utils/money';
import { resolveFinancialYear, toDateString, FinancialYearRow, isPeriodLocked } from './financialYear';
import { ensureVoucherType } from './companySetup';
import { docTypeForVoucherType, reserveNumber } from './numberSeries';

export type DrCr = 'Dr' | 'Cr';

export interface EntryInput {
    ledgerId: string;
    amount: number | string;
    type: DrCr;
    instrumentNumber?: string | null;
    instrumentDate?: string | null;
}

export interface VoucherInput {
    companyId: string;
    /** Either an id or a standard name such as 'Sales', 'Receipt'. */
    voucherTypeId?: string;
    voucherTypeName?: string;
    voucherNumber?: string | null;
    date: string | Date;
    narration?: string | null;
    entries: EntryInput[];
}

interface NormalisedEntry {
    ledgerId: string;
    paise: number;
    type: DrCr;
    instrumentNumber: string | null;
    instrumentDate: string | null;
}

/**
 * Validates and normalises entries: drops zero lines, flips negative amounts to
 * the other side, and enforces Dr total == Cr total to the paisa.
 */
export const normaliseEntries = (entries: EntryInput[]): { entries: NormalisedEntry[]; totalPaise: number } => {
    const out: NormalisedEntry[] = [];
    for (const e of entries || []) {
        if (e.type !== 'Dr' && e.type !== 'Cr') throw new AppError(`Invalid entry type "${e.type}"`, 400);
        if (!e.ledgerId) throw new AppError('Every entry needs a ledger', 400);
        let paise = toPaise(e.amount);
        let type = e.type;
        if (paise === 0) continue;
        if (paise < 0) {
            paise = -paise;
            type = type === 'Dr' ? 'Cr' : 'Dr';
        }
        out.push({
            ledgerId: e.ledgerId,
            paise,
            type,
            instrumentNumber: e.instrumentNumber || null,
            instrumentDate: e.instrumentDate || null,
        });
    }

    const dr = out.filter((e) => e.type === 'Dr').reduce((s, e) => s + e.paise, 0);
    const cr = out.filter((e) => e.type === 'Cr').reduce((s, e) => s + e.paise, 0);
    if (out.length < 2) throw new AppError('A voucher needs at least one debit and one credit entry', 400);
    if (dr !== cr) {
        throw new AppError(
            `Voucher is not balanced. Debit ${fromPaise(dr).toFixed(2)} ≠ Credit ${fromPaise(cr).toFixed(2)}`,
            400
        );
    }
    if (dr === 0) throw new AppError('Voucher total cannot be zero', 400);
    return { entries: out, totalPaise: dr };
};

/** Throws if `date` falls in a closed financial year. */
export const assertPeriodOpen = async (db: Queryable, companyId: string, date: string | Date) => {
    if (await isPeriodLocked(db, companyId, date)) {
        throw new AppError(`The financial year containing ${toDateString(date)} is closed`, 400);
    }
};

/** Ensures every ledger id belongs to the company. */
export const assertLedgersBelong = async (db: Queryable, companyId: string, ledgerIds: string[]) => {
    const unique = [...new Set(ledgerIds)];
    const r = await db.query('SELECT id FROM ledgers WHERE company_id = $1 AND id = ANY($2::uuid[])', [companyId, unique]);
    if (r.rows.length !== unique.length) throw new AppError('One or more ledgers do not belong to this company', 400);
};

const resolveVoucherType = async (db: Queryable, input: VoucherInput): Promise<{ id: string; name: string }> => {
    if (input.voucherTypeId) {
        const r = await db.query('SELECT id, name FROM voucher_types WHERE id = $1 AND company_id = $2', [
            input.voucherTypeId,
            input.companyId,
        ]);
        if (!r.rows.length) throw new AppError('Invalid voucher type', 400);
        return r.rows[0];
    }
    if (!input.voucherTypeName) throw new AppError('Voucher type is required', 400);
    return { id: await ensureVoucherType(db, input.companyId, input.voucherTypeName), name: input.voucherTypeName };
};

/**
 * Creates a voucher (or replaces an existing one when `existingId` is given).
 * Enforces: balanced entries, ledgers of the same company, open financial year,
 * and assigns a voucher number from the series when none is supplied.
 */
export const postVoucher = async (
    db: Queryable,
    input: VoucherInput,
    existingId?: string,
    opts: { numberDocType?: string; fy?: FinancialYearRow } = {}
) => {
    const { entries, totalPaise } = normaliseEntries(input.entries);
    await assertLedgersBelong(db, input.companyId, entries.map((e) => e.ledgerId));

    const date = toDateString(input.date);
    const fy = opts.fy ?? (await resolveFinancialYear(db, input.companyId, date));
    const vType = await resolveVoucherType(db, input);

    let voucher;
    if (existingId) {
        const prev = await db.query('SELECT * FROM vouchers WHERE id = $1 AND company_id = $2', [existingId, input.companyId]);
        if (!prev.rows.length) throw new AppError('Voucher not found', 404);
        await assertPeriodOpen(db, input.companyId, prev.rows[0].date); // the original period must be open too
        const number = input.voucherNumber?.trim() || prev.rows[0].voucher_number;
        voucher = (
            await db.query(
                `UPDATE vouchers SET voucher_type_id = $1, voucher_number = $2, date = $3, narration = $4,
                     total_amount = $5, financial_year_id = $6
                 WHERE id = $7 RETURNING *`,
                [vType.id, number, date, input.narration ?? null, fromPaise(totalPaise), fy.id, existingId]
            )
        ).rows[0];
        await db.query('DELETE FROM voucher_entries WHERE voucher_id = $1', [existingId]);
    } else {
        const docType = opts.numberDocType ?? docTypeForVoucherType(vType.name);
        const number = await reserveNumber(db, input.companyId, docType, fy, input.voucherNumber);
        voucher = (
            await db.query(
                `INSERT INTO vouchers (company_id, financial_year_id, voucher_type_id, voucher_number, date, narration, total_amount)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [input.companyId, fy.id, vType.id, number, date, input.narration ?? null, fromPaise(totalPaise)]
            )
        ).rows[0];
    }

    for (const e of entries) {
        await db.query(
            `INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type, instrument_number, instrument_date)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [voucher.id, e.ledgerId, fromPaise(e.paise), e.type, e.instrumentNumber, e.instrumentDate]
        );
    }
    return voucher;
};

/** Deletes a voucher after checking its period is open. */
export const removeVoucher = async (db: Queryable, companyId: string, voucherId: string) => {
    const prev = await db.query('SELECT * FROM vouchers WHERE id = $1 AND company_id = $2', [voucherId, companyId]);
    if (!prev.rows.length) return;
    await assertPeriodOpen(db, companyId, prev.rows[0].date);
    await db.query('DELETE FROM voucher_entries WHERE voucher_id = $1', [voucherId]);
    await db.query('DELETE FROM vouchers WHERE id = $1', [voucherId]);
};
