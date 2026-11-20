import os from 'os';
import cron from 'node-cron';
import { query } from '../config/db';
import { logger } from '../config/logger';
import { reportError } from '../config/errorReporter';

const TZ = process.env.TZ || 'Asia/Kolkata';

/** Today's date in the business time zone, e.g. "2026-11-20". */
export const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

/** ISO week in the business time zone, e.g. "2026-W47". */
export const weekKey = (d = new Date()) => {
    const [y, m, day] = dayKey(d).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, day));
    const dow = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dow);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

/**
 * Runs `fn` once per `runKey` across all app servers. The first server to claim
 * the slot runs it; the others skip. A failed run frees the slot so it can be retried.
 */
export const runOnce = async <T>(name: string, runKey: string, fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }> => {
    const claim = await query(
        `INSERT INTO job_runs (name, run_key, host) VALUES ($1, $2, $3)
         ON CONFLICT (name, run_key) WHERE status <> 'FAILED' DO NOTHING
         RETURNING id`,
        [name, runKey, os.hostname()]
    );
    if (!claim.rows.length) return { ran: false };
    const id = claim.rows[0].id;
    try {
        const result = await fn();
        await query(`UPDATE job_runs SET status = 'DONE', result = $2, finished_at = now() WHERE id = $1`, [id, JSON.stringify(result ?? null)]);
        return { ran: true, result };
    } catch (err) {
        await query(`UPDATE job_runs SET status = 'FAILED', error = $2, finished_at = now() WHERE id = $1`, [id, String((err as Error)?.stack || err).slice(0, 4000)]);
        throw err;
    }
};

/** Schedules a job with cron; each firing runs at most once per period across servers. */
export const scheduleJob = (
    name: string,
    cronExpr: string,
    period: () => string,
    fn: () => Promise<unknown>,
    { runAtStartup = false } = {}
) => {
    const fire = async () => {
        try {
            const r = await runOnce(name, period(), fn);
            if (r.ran) logger.info({ job: name, result: r.result ?? null }, `job ${name} done`);
        } catch (err) {
            reportError(err, { job: name });
        }
    };
    cron.schedule(cronExpr, fire, { timezone: TZ });
    if (runAtStartup) void fire();
};
