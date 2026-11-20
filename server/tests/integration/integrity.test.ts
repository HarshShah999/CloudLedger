import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { api, auth, closePool, createCompany, createLedger, ledgerByName, registerUser, resetDatabase } from './helpers';

let token: string;
let companyId: string;
const L: Record<string, any> = {};

beforeAll(async () => {
    await resetDatabase();
    ({ token } = await registerUser('Owner'));
    ({ id: companyId } = await createCompany(token));
    L.cash = await ledgerByName(token, companyId, 'Cash');
    L.rent = await createLedger(token, companyId, 'Rent', 'Indirect Expenses');
});

afterAll(closePool);

/** Runs statements in one transaction, the way the app writes vouchers. */
const inTx = async (fn: (c: any) => Promise<void>) => {
    const c = await pool.connect();
    try {
        await c.query('BEGIN');
        await fn(c);
        await c.query('COMMIT');
    } catch (e) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw e;
    } finally {
        c.release();
    }
};

describe('Rules the database enforces on its own', () => {
    it('rejects an unbalanced voucher even when written directly', async () => {
        const vt = (await pool.query(`SELECT id FROM voucher_types WHERE company_id = $1 AND name = 'Journal'`, [companyId])).rows[0].id;
        await expect(
            inTx(async (c) => {
                const v = await c.query(
                    `INSERT INTO vouchers (company_id, voucher_type_id, voucher_number, date, total_amount) VALUES ($1, $2, 'X1', '2025-06-01', 100) RETURNING id`,
                    [companyId, vt]
                );
                await c.query(`INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, 100, 'Dr')`, [v.rows[0].id, L.rent.id]);
                await c.query(`INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, 90, 'Cr')`, [v.rows[0].id, L.cash.id]);
            })
        ).rejects.toThrow(/not balanced/);
        // A balanced one with the wrong total is refused too
        await expect(
            inTx(async (c) => {
                const v = await c.query(
                    `INSERT INTO vouchers (company_id, voucher_type_id, voucher_number, date, total_amount) VALUES ($1, $2, 'X2', '2025-06-01', 999) RETURNING id`,
                    [companyId, vt]
                );
                await c.query(`INSERT INTO voucher_entries (voucher_id, ledger_id, amount, type) VALUES ($1, $2, 100, 'Dr'), ($1, $3, 100, 'Cr')`, [v.rows[0].id, L.rent.id, L.cash.id]);
            })
        ).rejects.toThrow(/does not match/);
        // The app's own vouchers pass
        const ok = await api().post('/api/vouchers').set(auth(token)).send({
            companyId, voucherTypeId: vt, date: '2025-06-01', narration: 'Rent',
            entries: [{ ledgerId: L.rent.id, amount: 100, type: 'Dr' }, { ledgerId: L.cash.id, amount: 100, type: 'Cr' }],
        });
        expect(ok.status).toBe(201);
    });

    it('refuses a second ledger or item with the same name, with a clear message', async () => {
        const groupId = (await pool.query(`SELECT group_id FROM ledgers WHERE id = $1`, [L.rent.id])).rows[0].group_id;
        const dup = await api().post('/api/ledgers').set(auth(token)).send({ companyId, name: 'RENT', groupId });
        expect(dup.status).toBeGreaterThanOrEqual(400);
        expect(dup.body.message).toMatch(/already exists/);
        await api().post('/api/inventory/items').set(auth(token)).send({ companyId, name: 'Cement' });
        const item = await api().post('/api/inventory/items').set(auth(token)).send({ companyId, name: 'cement' });
        expect(item.status).toBe(409);
        expect(item.body.message).toMatch(/item with this name/);
    });

    it('requires a company on business records and stores times with their zone', async () => {
        await expect(pool.query(`INSERT INTO ledgers (name, group_id) VALUES ('Orphan', (SELECT group_id FROM ledgers LIMIT 1))`)).rejects.toThrow(/company_id/);
        const t = await pool.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'created_at'`);
        expect(t.rows[0].data_type).toBe('timestamp with time zone');
        const left = await pool.query(`SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`);
        expect(left.rows[0].n).toBe(0);
    });
});
