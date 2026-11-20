import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { ImportReport } from './importCommon';
import { logger } from '../config/logger';

/**
 * Large imports (a few years of Tally Day Book) can take minutes, longer than
 * many proxies allow for one request. They run in the background on the server
 * that received the file; progress and the report are kept in the database, so
 * the page can poll any server. An import runs in one transaction: if the server
 * stops halfway, nothing is saved and the job is reported as interrupted.
 */
export interface ImportJob {
    id: string;
    companyId: string;
    dryRun: boolean;
    status: 'RUNNING' | 'DONE' | 'FAILED';
    done: number;
    total: number;
    report?: ImportReport;
    error?: string;
}

/** A running job that has not reported progress for this long has died with its server. */
const STALE_MS = 10 * 60 * 1000;
const PROGRESS_EVERY_MS = 1000;

export const startImportJob = async (
    companyId: string,
    userId: string,
    dryRun: boolean,
    work: (onProgress: (done: number, total: number) => void) => Promise<ImportReport>
): Promise<{ id: string }> => {
    // Clear jobs left "running" by a server that stopped
    await query(
        `UPDATE import_jobs SET status = 'FAILED', error = 'The import was interrupted (server restarted). Nothing was saved; please run it again.'
         WHERE company_id = $1 AND status = 'RUNNING' AND updated_at < now() - $2::interval`,
        [companyId, `${STALE_MS / 1000} seconds`]
    );
    let id: string;
    try {
        id = (await query('INSERT INTO import_jobs (company_id, user_id, dry_run) VALUES ($1, $2, $3) RETURNING id', [companyId, userId, dryRun])).rows[0].id;
    } catch (e: any) {
        if (e?.code === '23505') throw new AppError('An import is already running for this company. Wait for it to finish.', 409);
        throw e;
    }

    let last = 0;
    let latest = { done: 0, total: 0 };
    const onProgress = (done: number, total: number) => {
        latest = { done, total };
        const now = Date.now();
        if (now - last < PROGRESS_EVERY_MS) return;
        last = now;
        // Progress writes are not awaited; never let a late one overwrite the final result
        query(`UPDATE import_jobs SET done = $2, total = $3, updated_at = now() WHERE id = $1 AND status = 'RUNNING'`, [id, done, total]).catch(() => undefined);
    };

    work(onProgress)
        .then((report) =>
            query(
                `UPDATE import_jobs SET status = 'DONE', report = $2, done = $3, total = $3, updated_at = now() WHERE id = $1`,
                [id, JSON.stringify(report), latest.total]
            )
        )
        .catch((e: Error) => {
            if (!(e instanceof AppError)) logger.error({ err: e }, 'Import job failed');
            return query(`UPDATE import_jobs SET status = 'FAILED', error = $2, updated_at = now() WHERE id = $1`, [
                id,
                e instanceof AppError ? e.message : 'The import failed. Nothing was saved.',
            ]);
        })
        .catch((e) => logger.error({ err: e }, 'Could not record import result'));
    return { id };
};

export const getImportJob = async (id: string, userId: string): Promise<ImportJob> => {
    const r = await query('SELECT * FROM import_jobs WHERE id = $1 AND user_id = $2', [id, userId]).catch((e) => {
        if (e?.code === '22P02') return { rows: [] as any[] };
        throw e;
    });
    const j = r.rows[0];
    if (!j) throw new AppError('Import not found', 404);
    const stale = j.status === 'RUNNING' && Date.now() - new Date(j.updated_at).getTime() > STALE_MS;
    return {
        id: j.id,
        companyId: j.company_id,
        dryRun: j.dry_run,
        status: stale ? 'FAILED' : j.status,
        done: j.done,
        total: j.total,
        report: j.report ?? undefined,
        error: stale ? 'The import was interrupted (server restarted). Nothing was saved; please run it again.' : j.error ?? undefined,
    };
};
