import { PoolClient } from 'pg';
import { withTransaction } from '../config/db';

export interface ImportReport {
    dryRun: boolean;
    created: Record<string, number>;
    updated: Record<string, number>;
    skipped: Record<string, number>;
    /** Records that were not imported */
    errors: { ref: string; message: string }[];
    /** Records that were imported, but not completely (e.g. to the books only, not as a GST invoice) */
    warnings: { ref: string; message: string }[];
}

const newReport = (dryRun: boolean): ImportReport => ({ dryRun, created: {}, updated: {}, skipped: {}, errors: [], warnings: [] });
export const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

class DryRunRollback extends Error {}

/**
 * Runs an import in one transaction. In dry-run mode everything is executed and
 * then rolled back, so the report shows exactly what a real import would do.
 */
export const runImport = async (dryRun: boolean, fn: (db: PoolClient, report: ImportReport) => Promise<void>) => {
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
    report.warnings = report.warnings.slice(0, 200);
    return report;
};

/** Each row/voucher in its own savepoint: one bad record does not abort the rest. */
export const attempt = async (db: PoolClient, report: ImportReport, ref: string, fn: () => Promise<void>) => {
    await db.query('SAVEPOINT imp');
    try {
        await fn();
        await db.query('RELEASE SAVEPOINT imp');
    } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT imp');
        report.errors.push({ ref, message: (e as Error).message });
    }
};
