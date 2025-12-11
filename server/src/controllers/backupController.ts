import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import {
    createFullBackup,
    listBackups,
    deleteBackup,
    getBackupPath,
    cleanOldBackups
} from '../services/backupService';

// Create full database backup
export const createBackup = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user?.id;

        // Only admins can create backups
        const userRes = await query('SELECT role FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0 || userRes.rows[0].role !== 'admin') {
            return next(new AppError('Only administrators can create backups', 403));
        }

        console.log('Starting full database backup...');
        const backup = await createFullBackup();

        // Log backup creation (if table exists)
        try {
            await query(
                `INSERT INTO backup_logs (type, filename, file_size, status, created_by, storage_location)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                ['FULL', backup.filename, backup.size, 'SUCCESS', userId, 'local']
            );
        } catch (logError) {
            console.log('Could not log to backup_logs table - table may not exist yet');
        }

        res.status(200).json({
            status: 'success',
            message: 'Backup created successfully',
            data: {
                filename: backup.filename,
                size: backup.size,
                sizeFormatted: `${(backup.size / 1024 / 1024).toFixed(2)} MB`,
                createdAt: new Date()
            }
        });
    } catch (error: any) {
        // Log failed backup (if table exists)
        try {
            const userId = (req as any).user?.id;
            await query(
                `INSERT INTO backup_logs (type, status, error_message, created_by)
                 VALUES ($1, $2, $3, $4)`,
                ['FULL', 'FAILED', error.message, userId]
            );
        } catch (logError) {
            console.error('Failed to log backup error:', logError);
        }

        next(error);
    }
};

// Get list of all backups
export const getBackups = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user?.id;

        // Only admins can view backups
        const userRes = await query('SELECT role FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0 || userRes.rows[0].role !== 'admin') {
            return next(new AppError('Only administrators can view backups', 403));
        }

        const backups = await listBackups('full');

        // Get backup logs from database (if table exists)
        let logs = [];
        try {
            const logsRes = await query(
                `SELECT bl.*, u.name as created_by_name
                 FROM backup_logs bl
                 LEFT JOIN users u ON bl.created_by = u.id
                 WHERE bl.type = 'FULL'
                 ORDER BY bl.created_at DESC
                 LIMIT 50`
            );
            logs = logsRes.rows;
        } catch (logError) {
            // Table doesn't exist yet - that's okay, just return empty logs
            console.log('backup_logs table not found - please run migration 004_backup_logs.sql');
        }

        res.status(200).json({
            status: 'success',
            data: {
                backups,
                logs
            }
        });
    } catch (error) {
        next(error);
    }
};

// Download backup file
export const downloadBackup = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { filename } = req.params;
        const userId = (req as any).user?.id;

        // Only admins can download backups
        const userRes = await query('SELECT role FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0 || userRes.rows[0].role !== 'admin') {
            return next(new AppError('Only administrators can download backups', 403));
        }

        const filepath = getBackupPath(filename, 'full');

        // Check if file exists
        const fs = require('fs');
        if (!fs.existsSync(filepath)) {
            return next(new AppError('Backup file not found', 404));
        }

        // Send file
        res.download(filepath, filename, (err) => {
            if (err) {
                console.error('Download error:', err);
                next(new AppError('Failed to download backup', 500));
            }
        });
    } catch (error) {
        next(error);
    }
};

// Delete backup file
export const removeBackup = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { filename } = req.params;
        const userId = (req as any).user?.id;

        // Only admins can delete backups
        const userRes = await query('SELECT role FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0 || userRes.rows[0].role !== 'admin') {
            return next(new AppError('Only administrators can delete backups', 403));
        }

        await deleteBackup(filename, 'full');

        res.status(200).json({
            status: 'success',
            message: 'Backup deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};

// Clean old backups
export const cleanBackups = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user?.id;
        const { retentionDays = 30 } = req.body;

        // Only admins can clean backups
        const userRes = await query('SELECT role FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0 || userRes.rows[0].role !== 'admin') {
            return next(new AppError('Only administrators can clean backups', 403));
        }

        const deletedCount = await cleanOldBackups(retentionDays);

        res.status(200).json({
            status: 'success',
            message: `Cleaned ${deletedCount} old backups`,
            data: { deletedCount }
        });
    } catch (error) {
        next(error);
    }
};

// Restore database from backup (DANGEROUS - requires extra confirmation)
export const restoreBackup = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { filename, confirmPassword } = req.body;
        const userId = (req as any).user?.id;

        // Only admins can restore backups
        const userRes = await query('SELECT role, password FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0 || userRes.rows[0].role !== 'admin') {
            return next(new AppError('Only administrators can restore backups', 403));
        }

        // Verify password for extra security
        const bcrypt = await import('bcrypt');
        const isPasswordValid = await bcrypt.compare(confirmPassword, userRes.rows[0].password);
        if (!isPasswordValid) {
            return next(new AppError('Invalid password confirmation', 401));
        }

        const filepath = getBackupPath(filename, 'full');

        // Check if file exists
        const fs = require('fs');
        if (!fs.existsSync(filepath)) {
            return next(new AppError('Backup file not found', 404));
        }

        // Create a backup before restore (safety measure)
        console.log('Creating safety backup before restore...');
        const safetyBackup = await createFullBackup();
        console.log(`Safety backup created: ${safetyBackup.filename}`);

        // Perform restore
        const { restoreFromBackup } = await import('../services/backupService');
        await restoreFromBackup(filepath);

        // Log restore
        await query(
            `INSERT INTO restore_logs (backup_filename, type, status, restored_by)
             VALUES ($1, $2, $3, $4)`,
            [filename, 'FULL', 'SUCCESS', userId]
        );

        res.status(200).json({
            status: 'success',
            message: 'Database restored successfully',
            data: {
                restoredFrom: filename,
                safetyBackup: safetyBackup.filename
            }
        });
    } catch (error: any) {
        // Log failed restore
        try {
            const userId = (req as any).user?.id;
            const { filename } = req.body;
            await query(
                `INSERT INTO restore_logs (backup_filename, type, status, error_message, restored_by)
                 VALUES ($1, $2, $3, $4, $5)`,
                [filename, 'FULL', 'FAILED', error.message, userId]
            );
        } catch (logError) {
            console.error('Failed to log restore error:', logError);
        }

        next(error);
    }
};
