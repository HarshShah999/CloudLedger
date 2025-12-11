import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';

const execAsync = promisify(exec);

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

const logDebug = async (msg: string) => {
    try {
        await fs.appendFile('debug_backup.txt', new Date().toISOString() + ': ' + msg + '\n');
    } catch (e) { console.error('Failed to write log', e); }
    console.log(msg);
};

// Helper to find PostgreSQL binaries
const findPostgresBinary = async (binaryName: string): Promise<string> => {
    const fs = require('fs');

    if (process.platform === 'win32') {
        const versions = [17, 16, 15, 14];

        await logDebug(`🔍 Searching for ${binaryName} in PostgreSQL installations...`);

        for (const v of versions) {
            const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\${binaryName}.exe`;

            try {
                if (fs.existsSync(p)) {
                    await logDebug(`✅ Found ${binaryName} v${v} at: ${p}`);
                    return `"${p}"`;
                } else {
                    await logDebug(`❌ Checked v${v}: Not found`);
                }
            } catch (error: any) {
                await logDebug(`⚠️ Error checking v${v}: ${error.message}`);
            }
        }
    }

    // Final fallback to PATH
    await logDebug(`⚠️ Falling back to system PATH for ${binaryName}`);
    return binaryName;
};



// Ensure backup directories exist
export const initializeBackupDirectories = async () => {
    try {
        await fs.mkdir(BACKUP_DIR, { recursive: true });
        await fs.mkdir(FULL_BACKUP_DIR, { recursive: true });
        await fs.mkdir(COMPANY_BACKUP_DIR, { recursive: true });
        console.log('✅ Backup directories initialized');
    } catch (error) {
        console.error('❌ Failed to create backup directories:', error);
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
    const filename = `cloudledger_full_${timestamp}.sql`;
    const gzFilename = `${filename}.gz`;
    const sqlFilepath = path.join(FULL_BACKUP_DIR, filename);
    const gzFilepath = path.join(FULL_BACKUP_DIR, gzFilename);

    try {
        // Set PGPASSWORD environment variable for authentication
        const env = { ...process.env, PGPASSWORD: DB_PASSWORD };

        // Find pg_dump
        // const pgDumpPath = await findPostgresBinary('pg_dump');

        const pgDumpPath = `"C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe"`;


        // Create pg_dump command
        const dumpCommand = `${pgDumpPath} -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME} -F p -f "${sqlFilepath}"`;

        console.log(`Creating database backup with command: ${dumpCommand}`);
        try {
            await execAsync(dumpCommand, { env });
        } catch (execError: any) {
            console.error('pg_dump execution failed:', execError);
            throw new Error(`pg_dump failed: ${execError.message}`);
        }

        // Check if SQL file was created
        try {
            await fs.access(sqlFilepath);
        } catch {
            throw new Error('Backup file was not created by pg_dump');
        }

        // Compress the SQL file using Node.js zlib
        console.log('Compressing backup file...');
        try {
            const source = createReadStream(sqlFilepath);
            const destination = createWriteStream(gzFilepath);
            const gzip = createGzip();
            await pipeline(source, gzip, destination);
        } catch (zipError: any) {
            console.error('Compression failed:', zipError);
            throw new Error(`Compression failed: ${zipError.message}`);
        }

        // Remove the raw SQL file
        await fs.unlink(sqlFilepath).catch(() => { });

        // Get file size
        const stats = await fs.stat(gzFilepath);

        console.log(`✅ Backup created: ${gzFilename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

        return {
            filename: gzFilename,
            filepath: gzFilepath,
            size: stats.size
        };
    } catch (error: any) {
        console.error('❌ Backup creation failed:', error);
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
        console.error('Error listing backups:', error);
        return [];
    }
};

// Delete a backup file
export const deleteBackup = async (filename: string, type: 'full' | 'company' = 'full'): Promise<void> => {
    const dir = type === 'full' ? FULL_BACKUP_DIR : COMPANY_BACKUP_DIR;
    const filepath = path.join(dir, filename);

    try {
        await fs.unlink(filepath);
        console.log(`✅ Backup deleted: ${filename}`);
    } catch (error: any) {
        console.error('❌ Failed to delete backup:', error);
        throw new Error(`Failed to delete backup: ${error.message}`);
    }
};

// Restore database from backup
export const restoreFromBackup = async (filepath: string): Promise<void> => {
    try {
        // Set PGPASSWORD environment variable
        const env = { ...process.env, PGPASSWORD: DB_PASSWORD };

        let sqlFilepath = filepath;
        const cleanupFiles: string[] = [];

        // Decompress if gzipped
        if (filepath.endsWith('.gz')) {
            console.log('Decompressing backup file...');
            const tempSqlFile = filepath.replace('.gz', '');

            try {
                const source = createReadStream(filepath);
                const destination = createWriteStream(tempSqlFile);
                const gunzip = createGunzip();
                await pipeline(source, gunzip, destination);

                sqlFilepath = tempSqlFile;
                cleanupFiles.push(tempSqlFile);
            } catch (unzipError: any) {
                console.error('Decompression failed:', unzipError);
                throw new Error(`Decompression failed: ${unzipError.message}`);
            }
        }

        console.log('Restoring database...');

        // Verify SQL file exists
        try {
            await fs.access(sqlFilepath);
        } catch {
            throw new Error(`Restore file not found: ${sqlFilepath}`);
        }

        // Find psql binary
        const psqlPath = await findPostgresBinary('psql');

        // Drop and recreate database (WARNING: This deletes all data!)
        // Note: Connecting to 'postgres' database to drop 'cloudledger'
        const dropCommand = `${psqlPath} -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};"`;
        await execAsync(dropCommand, { env });

        const createCommand = `${psqlPath} -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -c "CREATE DATABASE ${DB_NAME};"`;
        await execAsync(createCommand, { env });

        // Restore from backup
        const restoreCommand = `${psqlPath} -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME} -f "${sqlFilepath}"`;
        await execAsync(restoreCommand, { env });

        // Clean up temp files
        for (const file of cleanupFiles) {
            await fs.unlink(file).catch(() => { });
        }

        console.log('✅ Database restored successfully');
    } catch (error: any) {
        console.error('❌ Restore failed:', error);
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

        console.log(`✅ Cleaned ${deletedCount} old backups`);
        return deletedCount;
    } catch (error) {
        console.error('Error cleaning old backups:', error);
        return 0;
    }
};

// Get backup file path
export const getBackupPath = (filename: string, type: 'full' | 'company' = 'full'): string => {
    const dir = type === 'full' ? FULL_BACKUP_DIR : COMPANY_BACKUP_DIR;
    return path.join(dir, filename);
};
