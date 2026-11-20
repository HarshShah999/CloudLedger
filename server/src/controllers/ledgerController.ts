import { Request, Response } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { stateCode, stateName, validateGstin } from '../utils/gst';

/**
 * Normalises a party's GST profile: state from GSTIN, registration type defaults,
 * and consistency checks (a GSTIN's state code must match the state).
 */
const gstProfile = (b: any) => {
    const gstin = b.gstin ? String(b.gstin).toUpperCase() : null;
    let state = b.state || null;
    let type = b.gstRegistrationType || null;
    if (gstin) {
        const check = validateGstin(gstin);
        if (!check.valid) throw new AppError(check.reason, 400);
        const fromGstin = stateName(check.stateCode);
        if (!state) state = fromGstin;
        else if (stateCode(state) && stateCode(state) !== check.stateCode) {
            throw new AppError(`GSTIN belongs to ${fromGstin}, but the state is ${state}`, 400);
        }
        if (type === 'UNREGISTERED' || type === 'CONSUMER') throw new AppError('A party with a GSTIN cannot be unregistered', 400);
        if (!type) type = 'REGULAR';
    } else if (type === 'REGULAR' || type === 'COMPOSITION' || type === 'SEZ') {
        throw new AppError('Enter the GSTIN for a registered party', 400);
    }
    return { gstin, state, type, pan: b.pan ? String(b.pan).toUpperCase() : gstin ? gstin.slice(2, 12) : null };
};

const assertGroupInCompany = async (companyId: string, groupId: string | null | undefined) => {
    if (!groupId) return;
    const r = await query('SELECT 1 FROM ledger_groups WHERE id = $1 AND company_id = $2', [groupId, companyId]);
    if (!r.rows.length) throw new AppError('Group not found in this company', 400);
};

const assertUniqueName = async (companyId: string, name: string, exceptId?: string) => {
    const r = await query(
        'SELECT 1 FROM ledgers WHERE company_id = $1 AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3)',
        [companyId, name.trim(), exceptId ?? null]
    );
    if (r.rows.length) throw new AppError(`A ledger named "${name}" already exists`, 400);
};

/* ---------- Groups ---------- */

export const getGroups = async (req: Request, res: Response) => {
    const result = await query(
        `SELECT g.*, p.name AS parent_name FROM ledger_groups g
         LEFT JOIN ledger_groups p ON p.id = g.parent_id
         WHERE g.company_id = $1 ORDER BY g.type, g.name`,
        [req.company!.id]
    );
    res.status(200).json({ status: 'success', data: { groups: result.rows } });
};

export const createGroup = async (req: Request, res: Response) => {
    const { name, parentId, type } = req.body;
    const companyId = req.company!.id;
    await assertGroupInCompany(companyId, parentId);
    if (parentId) {
        const parent = await query('SELECT type FROM ledger_groups WHERE id = $1', [parentId]);
        if (parent.rows[0].type !== type) throw new AppError('A sub-group must have the same nature as its parent', 400);
    }
    const result = await query(
        'INSERT INTO ledger_groups (company_id, name, parent_id, type) VALUES ($1, $2, $3, $4) RETURNING *',
        [companyId, name.trim(), parentId || null, type]
    );
    res.status(201).json({ status: 'success', data: { group: result.rows[0] } });
};

/* ---------- Ledgers ---------- */

export const getLedgers = async (req: Request, res: Response) => {
    const result = await query(
        `SELECT l.*, lg.name AS group_name, lg.type AS group_type, lg.code AS group_code
         FROM ledgers l LEFT JOIN ledger_groups lg ON l.group_id = lg.id
         WHERE l.company_id = $1 ORDER BY l.name`,
        [req.company!.id]
    );
    res.status(200).json({ status: 'success', data: { ledgers: result.rows } });
};

export const createLedger = async (req: Request, res: Response) => {
    const companyId = req.company!.id;
    const { groupId, name, openingBalance, openingBalanceType, email, phone, address } = req.body;
    await assertGroupInCompany(companyId, groupId);
    await assertUniqueName(companyId, name);
    const g = gstProfile(req.body);
    const result = await query(
        `INSERT INTO ledgers (company_id, group_id, name, opening_balance, opening_balance_type, current_balance,
                              state, gstin, email, phone, address, gst_registration_type, pan, city, pincode)
         VALUES ($1, $2, $3, $4, $5, $4, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [
            companyId, groupId, name.trim(), openingBalance || 0, openingBalanceType || 'Dr',
            g.state, g.gstin, email || null, phone || null, address || null, g.type, g.pan,
            req.body.city || null, req.body.pincode || null,
        ]
    );
    res.status(201).json({ status: 'success', data: { ledger: result.rows[0] } });
};

export const updateLedger = async (req: Request, res: Response) => {
    const companyId = req.company!.id;
    const { id } = req.params;
    const { name, groupId, openingBalance, openingBalanceType, email, phone, address } = req.body;
    await assertGroupInCompany(companyId, groupId);
    if (name) await assertUniqueName(companyId, name, id);
    // Fields not sent keep their current values
    const cur = (await query('SELECT * FROM ledgers WHERE id = $1 AND company_id = $2', [id, companyId])).rows[0];
    if (!cur) throw new AppError('Ledger not found', 404);
    const pick = (k: string, col: string) => (k in req.body ? req.body[k] : cur[col]);
    const g = gstProfile({
        gstin: pick('gstin', 'gstin'), state: pick('state', 'state'),
        gstRegistrationType: pick('gstRegistrationType', 'gst_registration_type'), pan: pick('pan', 'pan'),
    });

    const result = await query(
        `UPDATE ledgers SET
            name = COALESCE($1, name), group_id = COALESCE($2, group_id),
            opening_balance = COALESCE($3, opening_balance), opening_balance_type = COALESCE($4, opening_balance_type),
            state = $5, gstin = $6, email = $7, phone = $8, address = $9, gst_registration_type = $12, pan = $13,
            city = $14, pincode = $15
         WHERE id = $10 AND company_id = $11 RETURNING *`,
        [
            name?.trim() || null, groupId || null, openingBalance ?? null, openingBalanceType || null,
            g.state, g.gstin, pick('email', 'email') || null, pick('phone', 'phone') || null, pick('address', 'address') || null,
            id, companyId, g.type, g.pan, pick('city', 'city') || null, pick('pincode', 'pincode') || null,
        ]
    );
    if (!result.rows.length) throw new AppError('Ledger not found', 404);
    res.status(200).json({ status: 'success', data: { ledger: result.rows[0] } });
};

export const deleteLedger = async (req: Request, res: Response) => {
    const { id } = req.params;
    const used = await query(
        `SELECT
            (SELECT COUNT(*) FROM voucher_entries WHERE ledger_id = $1)::int AS entries,
            (SELECT COUNT(*) FROM invoices WHERE party_ledger_id = $1 OR sales_ledger_id = $1)::int AS invoices`,
        [id]
    );
    if (used.rows[0].entries > 0 || used.rows[0].invoices > 0) {
        throw new AppError('Cannot delete a ledger that has transactions or invoices', 400);
    }
    await query('DELETE FROM ledgers WHERE id = $1 AND company_id = $2', [id, req.company!.id]);
    res.status(204).send();
};
