import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { dayKey, runOnce, weekKey } from '../../src/jobs/runner';
import { closePool, resetDatabase } from './helpers';

beforeAll(resetDatabase);
afterAll(closePool);

describe('Scheduled jobs across several servers', () => {
    it('runs a job once per period even when two servers fire together', async () => {
        let runs = 0;
        const work = async () => {
            runs++;
            await new Promise((r) => setTimeout(r, 50));
            return { sent: 3 };
        };
        const [a, b, c] = await Promise.all([runOnce('reminders', '2026-11-20', work), runOnce('reminders', '2026-11-20', work), runOnce('reminders', '2026-11-20', work)]);
        expect(runs).toBe(1);
        expect([a, b, c].filter((x) => x.ran)).toHaveLength(1);
        // The next day is a new slot
        expect((await runOnce('reminders', '2026-11-21', work)).ran).toBe(true);
        const rows = await pool.query(`SELECT status, result FROM job_runs WHERE name = 'reminders' ORDER BY run_key`);
        expect(rows.rows).toEqual([{ status: 'DONE', result: { sent: 3 } }, { status: 'DONE', result: { sent: 3 } }]);
    });

    it('records a failure and lets the job be retried', async () => {
        await expect(runOnce('backup', '2026-11-20', async () => { throw new Error('disk full'); })).rejects.toThrow('disk full');
        const retry = await runOnce('backup', '2026-11-20', async () => ({ ok: true }));
        expect(retry.ran).toBe(true);
        const rows = await pool.query(`SELECT status, error FROM job_runs WHERE name = 'backup' ORDER BY id`);
        expect(rows.rows.map((r) => r.status)).toEqual(['FAILED', 'DONE']);
        expect(rows.rows[0].error).toMatch(/disk full/);
    });

    it('names periods in India time', () => {
        // 20:00 UTC on 20 Nov is already 21 Nov in India
        expect(dayKey(new Date('2026-11-20T20:00:00Z'))).toBe('2026-11-21');
        expect(weekKey(new Date('2026-11-20T06:00:00Z'))).toBe('2026-W47');
    });
});
