import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { api, auth, closePool, createCompany, createLedger, ledgerByName, registerUser, resetDatabase } from './helpers';

let token: string;
let userId: string;
let companyId: string;
let invoiceId: string;
let party: { id: string };
let sales: { id: string };

beforeAll(async () => {
    await resetDatabase();
    const u = await registerUser('Auditor Owner');
    token = u.token;
    userId = u.user.id;
    ({ id: companyId } = await createCompany(token));
    party = await createLedger(token, companyId, 'Ravi Stores', 'Sundry Debtors');
    sales = await ledgerByName(token, companyId, 'Sales');
    const inv = await api().post('/api/invoices').set(auth(token)).send({
        companyId, type: 'SALES', partyLedgerId: party.id, salesLedgerId: sales.id, date: '2025-06-10',
        items: [{ description: 'Widget', quantity: 2, rate: 100, taxRate: 18 }],
    });
    invoiceId = inv.body.data.invoice.id;
});

afterAll(closePool);

describe('audit trail', () => {
    it('records who created a document, with its values', async () => {
        const r = await pool.query(
            `SELECT * FROM audit_log WHERE table_name = 'invoices' AND record_id = $1 AND action = 'INSERT'`,
            [invoiceId]
        );
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].user_id).toBe(userId);
        expect(r.rows[0].company_id).toBe(companyId);
        expect(Number(r.rows[0].new_data.grand_total)).toBe(236);
    });

    it('records the before and after values of an edit', async () => {
        const res = await api().put(`/api/invoices/${invoiceId}`).set(auth(token)).send({
            type: 'SALES', partyLedgerId: party.id, salesLedgerId: sales.id, date: '2025-06-10',
            items: [{ description: 'Widget', quantity: 3, rate: 100, taxRate: 18 }],
        });
        expect(res.status).toBe(200);
        const r = await pool.query(
            `SELECT * FROM audit_log WHERE table_name = 'invoices' AND record_id = $1 AND action = 'UPDATE'`,
            [invoiceId]
        );
        const upd = r.rows.find((x) => x.changed_fields.includes('grand_total'));
        expect(Number(upd.old_data.grand_total)).toBe(236);
        expect(Number(upd.new_data.grand_total)).toBe(354);
        expect(upd.user_id).toBe(userId);
    });

    it('keeps a record of single-statement writes such as ledger edits', async () => {
        await api().put(`/api/ledgers/${party.id}`).set(auth(token)).send({ phone: '9876543210' });
        const r = await pool.query(`SELECT * FROM audit_log WHERE table_name = 'ledgers' AND record_id = $1 AND action = 'UPDATE'`, [party.id]);
        expect(r.rows.at(-1).changed_fields).toContain('phone');
        expect(r.rows.at(-1).user_id).toBe(userId);
    });

    it('records cancellations and deletions, and never stores password hashes', async () => {
        // Issued invoices are cancelled, not deleted; the change is in the audit trail
        expect((await api().delete(`/api/invoices/${invoiceId}`).set(auth(token))).status).toBe(400);
        expect((await api().post(`/api/invoices/${invoiceId}/cancel`).set(auth(token)).send({ reason: 'Wrong party' })).status).toBe(200);
        const cancel = await pool.query(`SELECT * FROM audit_log WHERE table_name = 'invoices' AND record_id = $1 AND action = 'UPDATE' ORDER BY id DESC LIMIT 1`, [invoiceId]);
        expect(cancel.rows[0].new_data).toMatchObject({ status: 'CANCELLED', cancel_reason: 'Wrong party' });
        // The cancelled invoice's voucher was removed, and that deletion is recorded too
        const del = await pool.query(`SELECT * FROM audit_log WHERE table_name = 'vouchers' AND action = 'DELETE' AND old_data->>'voucher_number' = 'INV/25-26/0001'`);
        expect(del.rows).toHaveLength(1);
        const pw = await pool.query(`SELECT COUNT(*)::int n FROM audit_log WHERE old_data ? 'password' OR new_data ? 'password'`);
        expect(pw.rows[0].n).toBe(0);
    });

    it('cannot be altered, deleted or truncated — even directly in the database', async () => {
        await expect(pool.query(`UPDATE audit_log SET user_id = NULL`)).rejects.toThrow(/append-only/);
        await expect(pool.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
        await expect(pool.query(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/);
    });

    it('logs changes made outside the app too (no user attached)', async () => {
        await pool.query(`UPDATE ledgers SET address = 'Changed in psql' WHERE id = $1`, [party.id]);
        const r = await pool.query(`SELECT * FROM audit_log WHERE record_id = $1 ORDER BY id DESC LIMIT 1`, [party.id]);
        expect(r.rows[0].changed_fields).toEqual(['address']);
        expect(r.rows[0].user_id).toBeNull();
    });

    it('serves the log and a grouped document history over the API', async () => {
        const log = await api().get('/api/audit').query({ companyId }).set(auth(token));
        expect(log.status).toBe(200);
        expect(log.body.data.entries.some((e: any) => e.entity === 'Invoice' && e.action === 'UPDATE')).toBe(true);
        expect(log.body.data.entries.every((e: any) => e.table !== 'voucher_entries')).toBe(true);

        const hist = await api().get(`/api/audit/record/${invoiceId}`).query({ companyId }).set(auth(token));
        expect(hist.body.data.history.length).toBe(3); // created, edited, cancelled
        expect(hist.body.data.history[0].changes.some((c: any) => c.new_data?.status === 'CANCELLED' || c.changes?.status || c.action === 'UPDATE')).toBe(true);
        expect(hist.body.data.history[0].user).toBe('Auditor Owner');
    });

    it('does not show another company’s log', async () => {
        const { token: other } = await registerUser('Other');
        expect((await api().get('/api/audit').query({ companyId }).set(auth(other))).status).toBe(403);
    });
});
