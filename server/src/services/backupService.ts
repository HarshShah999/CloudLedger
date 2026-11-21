import { query as dbQuery } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream, existsSync } from 'fs';
import { logger } from '../config/logger';

const execFileAsync = promisify(execFile);

// Backup directory configuration
const BACKUP_DIR = process.env.BACKUP_DIR || './backups';
const FULL_BACKUP_DIR = path.join(BACKUP_DIR, 'full');
const COMPANY_BACKUP_DIR = path.join(BACKUP_DIR, 'companies');

// Database configuration
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'cloudledger';

/**
 * Finds pg_dump / psql: PG_BIN_DIR if set, else the usual Windows install folders,
 * else the system PATH (Linux/macOS servers and containers).
 */
const findPostgresBinary = (binaryName: 'pg_dump' | 'psql'): string => {
    if (process.env.PG_BIN_DIR) return path.join(process.env.PG_BIN_DIR, process.platform === 'win32' ? `${binaryName}.exe` : binaryName);
    if (process.platform === 'win32') {
        for (const v of [18, 17, 16, 15, 14]) {
            const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\${binaryName}.exe`;
            if (existsSync(p)) return p;
        }
    }
    return binaryName;
};

/** Runs a PostgreSQL tool without a shell (arguments are never interpreted as commands). */
const runPgTool = async (binary: 'pg_dump' | 'psql', args: string[]) => {
    try {
        await execFileAsync(findPostgresBinary(binary), ['-h', DB_HOST, '-p', String(DB_PORT), '-U', DB_USER, ...args], {
            env: { ...process.env, PGPASSWORD: DB_PASSWORD },
            maxBuffer: 64 * 1024 * 1024,
        });
    } catch (e: any) {
        // Keep the tool's own message (e.g. version mismatch) but never echo the environment
        throw new Error(`${binary} failed: ${String(e.stderr || e.message).trim().split('\n').slice(-3).join(' ')}`);
    }
};

// Ensure backup directories exist
export const initializeBackupDirectories = async () => {
    try {
        await fs.mkdir(BACKUP_DIR, { recursive: true });
        await fs.mkdir(FULL_BACKUP_DIR, { recursive: true });
        await fs.mkdir(COMPANY_BACKUP_DIR, { recursive: true });
        logger.info('✅ Backup directories initialized');
    } catch (error) {
        logger.error({ err: error }, '❌ Failed to create backup directories:');
        throw error;
    }
};

// Generate timestamp for backup filenames
const getTimestamp = (): string => {
    return new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
};

// Create full database backup using pg_dump
export const createFullBackup = async (): Promise<{ filename: string; filepath: string; size: number }> => {
    const timestamp = getTimestamp();
    const filename = `taalmel_full_${timestamp}.sql`;
    const gzFilename = `${filename}.gz`;
    const sqlFilepath = path.join(FULL_BACKUP_DIR, filename);
    const gzFilepath = path.join(FULL_BACKUP_DIR, gzFilename);

    try {
        await fs.mkdir(FULL_BACKUP_DIR, { recursive: true });
        // Plain SQL that drops and recreates each object, so it can be restored into
        // the existing database without dropping the database itself
        await runPgTool('pg_dump', ['-d', DB_NAME, '-F', 'p', '--clean', '--if-exists', '--no-owner', '--no-privileges', '-f', sqlFilepath]);

        // Check if SQL file was created
        try {
            await fs.access(sqlFilepath);
        } catch {
            throw new Error('Backup file was not created by pg_dump');
        }

        // Compress the SQL file using Node.js zlib
        logger.info('Compressing backup file...');
        try {
            const source = createReadStream(sqlFilepath);
            const destination = createWriteStream(gzFilepath);
            const gzip = createGzip();
            await pipeline(source, gzip, destination);
        } catch (zipError: any) {
            logger.error({ err: zipError }, 'Compression failed:');
            throw new Error(`Compression failed: ${zipError.message}`);
        }

        // Remove the raw SQL file
        await fs.unlink(sqlFilepath).catch(() => { });

        // Get file size
        const stats = await fs.stat(gzFilepath);

        logger.info(`✅ Backup created: ${gzFilename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

        return {
            filename: gzFilename,
            filepath: gzFilepath,
            size: stats.size
        };
    } catch (error: any) {
        logger.error({ err: error }, '❌ Backup creation failed:');
        // Clean up any partial files
        await fs.unlink(sqlFilepath).catch(() => { });
        await fs.unlink(gzFilepath).catch(() => { });
        throw new Error(`Backup failed: ${error.message}`);
    }
};

// List all backups
export const listBackups = async (type: 'full' | 'company' = 'full'): Promise<any[]> => {
    const dir = type === 'full' ? FULL_BACKUP_DIR : COMPANY_BACKUP_DIR;

    try {
        const files = await fs.readdir(dir);
        const backups = await Promise.all(
            files.map(async (file) => {
                const filepath = path.join(dir, file);
                const stats = await fs.stat(filepath);
                return {
                    filename: file,
                    filepath,
                    size: stats.size,
                    sizeFormatted: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
                    createdAt: stats.birthtime,
                    type
                };
            })
        );

        // Sort by creation date (newest first)
        return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
        logger.error({ err: error }, 'Error listing backups:');
        return [];
    }
};

// Delete a backup file
export const deleteBackup = async (filename: string, type: 'full' | 'company' = 'full'): Promise<void> => {
    const filepath = getBackupPath(filename, type);

    try {
        await fs.unlink(filepath);
        logger.info(`✅ Backup deleted: ${filename}`);
    } catch (error: any) {
        logger.error({ err: error }, '❌ Failed to delete backup:');
        throw new Error(`Failed to delete backup: ${error.message}`);
    }
};

// Restore database from backup
export const restoreFromBackup = async (filepath: string): Promise<void> => {
    try {
        let sqlFilepath = filepath;
        const cleanupFiles: string[] = [];

        // Decompress if gzipped
        if (filepath.endsWith('.gz')) {
            logger.info('Decompressing backup file...');
            const tempSqlFile = filepath.replace('.gz', '');

            try {
                const source = createReadStream(filepath);
                const destination = createWriteStream(tempSqlFile);
                const gunzip = createGunzip();
                await pipeline(source, gunzip, destination);

                sqlFilepath = tempSqlFile;
                cleanupFiles.push(tempSqlFile);
            } catch (unzipError: any) {
                logger.error({ err: unzipError }, 'Decompression failed:');
                throw new Error(`Decompression failed: ${unzipError.message}`);
            }
        }

        logger.info('Restoring database...');

        // Verify SQL file exists
        try {
            await fs.access(sqlFilepath);
        } catch {
            throw new Error(`Restore file not found: ${sqlFilepath}`);
        }

        // One transaction: if anything fails, the database is left exactly as it was
        await runPgTool('psql', ['-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q', '-f', sqlFilepath]);

        // Clean up temp files
        for (const file of cleanupFiles) {
            await fs.unlink(file).catch(() => { });
        }

        logger.info('✅ Database restored successfully');
    } catch (error: any) {
        logger.error({ err: error }, '❌ Restore failed:');
        throw new Error(`Restore failed: ${error.message}`);
    }
};

// Clean old backups based on retention policy
export const cleanOldBackups = async (retentionDays: number = 30): Promise<number> => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
        const backups = await listBackups('full');
        let deletedCount = 0;

        for (const backup of backups) {
            if (backup.createdAt < cutoffDate) {
                await deleteBackup(backup.filename, 'full');
                deletedCount++;
            }
        }

        logger.info(`✅ Cleaned ${deletedCount} old backups`);
        return deletedCount;
    } catch (error) {
        logger.error({ err: error }, 'Error cleaning old backups:');
        return 0;
    }
};

// Get backup file path
/** Only plain backup file names are accepted (no directories, no traversal). */
export const safeBackupName = (filename: string): string => {
    const base = path.basename(String(filename || ''));
    if (!/^[A-Za-z0-9._-]+\.(sql|sql\.gz|json)$/.test(base) || base.startsWith('.')) {
        throw new AppError('Invalid backup file name', 400);
    }
    return base;
};

export const getBackupPath = (filename: string, type: 'full' | 'company' = 'full'): string => {
    const dir = type === 'full' ? FULL_BACKUP_DIR : COMPANY_BACKUP_DIR;
    return path.join(dir, safeBackupName(filename));
};

/* ---------- Backup and restore log (backup_logs / restore_logs) ---------- */

export const logBackup = async (entry: { status: 'SUCCESS' | 'FAILED'; filename?: string; size?: number; error?: string; userId?: string | null }) => {
    await dbQuery(
        `INSERT INTO backup_logs (type, filename, file_size, status, error_message, created_by, storage_location)
         VALUES ('FULL', $1, $2, $3, $4, $5, 'local')`,
        [entry.filename ?? null, entry.size ?? null, entry.status, entry.error ?? null, entry.userId ?? null]
    );
};

export const listBackupLogs = async () =>
    (
        await dbQuery(
            `SELECT bl.*, u.name as created_by_name
             FROM backup_logs bl
             LEFT JOIN users u ON bl.created_by = u.id
             WHERE bl.type = 'FULL'
             ORDER BY bl.created_at DESC
             LIMIT 50`
        )
    ).rows;

export const logRestore = async (entry: { filename: string; status: 'SUCCESS' | 'FAILED'; error?: string; userId: string }) => {
    await dbQuery(
        `INSERT INTO restore_logs (backup_filename, type, status, error_message, restored_by) VALUES ($1, 'FULL', $2, $3, $4)`,
        [entry.filename, entry.status, entry.error ?? null, entry.userId]
    );
};
