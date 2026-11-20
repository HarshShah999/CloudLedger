/**
 * Health checks for load balancers and uptime monitors.
 *  - live:  the process is up (no dependencies checked)
 *  - ready: the database answers within 2 s; 503 otherwise, so traffic is routed elsewhere
 *  - status (detail): database latency, last run of each scheduled job, and whether the
 *    daily backup is overdue; an uptime monitor can alert on "degraded".
 */
import { query } from '../config/db';

const withTimeout = <T>(p: Promise<T>, ms: number) =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms))]);

export const checkDatabase = async () => {
    const started = Date.now();
    try {
        await withTimeout(query('SELECT 1'), 2000);
        return { ok: true, latencyMs: Date.now() - started };
    } catch (e) {
        return { ok: false, error: (e as Error).message };
    }
};

export const healthStatus = async () => {
    const db = await checkDatabase();
    let jobs: { name: string; status: string; run_key: string; finished_at: string | null; error: string | null }[] = [];
    let backupOverdue = false;
    if (db.ok) {
        jobs = (
            await query(
                `SELECT DISTINCT ON (name) name, status, run_key, finished_at, left(error, 200) AS error
                 FROM job_runs ORDER BY name, started_at DESC`
            )
        ).rows;
        const backupsOn = process.env.BACKUP_AUTO_ENABLED !== 'false';
        if (backupsOn) {
            const last = (await query(`SELECT max(finished_at) AS at FROM job_runs WHERE name = 'backup' AND status = 'DONE'`)).rows[0].at;
            // A daily backup older than two days (or none yet, once the server has run a day) needs attention
            const uptimeH = process.uptime() / 3600;
            backupOverdue = last ? Date.now() - new Date(last).getTime() > 48 * 3600 * 1000 : uptimeH > 26;
        }
    }
    const failedJobs = jobs.filter((j) => j.status === 'FAILED').map((j) => j.name);
    const status = !db.ok ? 'down' : failedJobs.length || backupOverdue ? 'degraded' : 'ok';
    return {
        status,
        uptimeSeconds: Math.round(process.uptime()),
        version: process.env.APP_VERSION || process.env.npm_package_version || 'dev',
        database: db,
        jobs,
        backupOverdue,
        failedJobs,
    };
};
