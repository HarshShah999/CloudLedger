import crypto from 'crypto';
import { AppError } from '../middleware/errorHandler';
import { ImportReport } from './importCommon';

/**
 * Large imports (a few years of Tally Day Book) can take minutes, longer than
 * many proxies allow for one request. They run in the background and the page
 * polls for progress. Jobs live in memory for an hour; a server restart during
 * an import rolls it back (it runs in one transaction), so nothing is half-saved.
 */
export interface ImportJob {
    id: string;
    companyId: string;
    userId: string;
    dryRun: boolean;
    status: 'running' | 'done' | 'failed';
    done: number;
    total: number;
    report?: ImportReport;
    error?: string;
    startedAt: number;
}

const jobs = new Map<string, ImportJob>();
const KEEP_MS = 60 * 60 * 1000;

const prune = () => {
    const cutoff = Date.now() - KEEP_MS;
    for (const [id, j] of jobs) if (j.status !== 'running' && j.startedAt < cutoff) jobs.delete(id);
};

export const startImportJob = (
    companyId: string,
    userId: string,
    dryRun: boolean,
    work: (onProgress: (done: number, total: number) => void) => Promise<ImportReport>
): ImportJob => {
    prune();
    if ([...jobs.values()].some((j) => j.companyId === companyId && j.status === 'running')) {
        throw new AppError('An import is already running for this company. Wait for it to finish.', 409);
    }
    const job: ImportJob = { id: crypto.randomUUID(), companyId, userId, dryRun, status: 'running', done: 0, total: 0, startedAt: Date.now() };
    jobs.set(job.id, job);
    work((done, total) => {
        job.done = done;
        job.total = total;
    })
        .then((report) => {
            job.report = report;
            job.done = job.total;
            job.status = 'done';
        })
        .catch((e: Error) => {
            job.error = e instanceof AppError ? e.message : 'The import failed. Nothing was saved.';
            if (!(e instanceof AppError)) console.error('Import job failed', e);
            job.status = 'failed';
        });
    return job;
};

export const getImportJob = (id: string, userId: string) => {
    const job = jobs.get(id);
    if (!job || job.userId !== userId) throw new AppError('Import not found', 404);
    return job;
};
