import fs from 'fs';
import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import {
    cleanOldBackups, createFullBackup, deleteBackup, getBackupPath, listBackupLogs, listBackups, logBackup, logRestore, restoreFromBackup,
} from '../services/backupService';
import { verifyPassword } from '../services/userService';

// Every route here is limited to the platform super-admin (requireSuperadmin in the router).

export const createBackup = async (req: Request, res: Response) => {
    try {
        const backup = await createFullBackup();
        await logBackup({ status: 'SUCCESS', filename: backup.filename, size: backup.size, userId: req.user!.id });
        res.status(200).json({
            status: 'success',
            message: 'Backup created successfully',
            data: { filename: backup.filename, size: backup.size, sizeFormatted: `${(backup.size / 1024 / 1024).toFixed(2)} MB`, createdAt: new Date() },
        });
    } catch (error: any) {
        await logBackup({ status: 'FAILED', error: error.message, userId: req.user!.id }).catch(() => undefined);
        throw error;
    }
};

export const getBackups = async (_req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { backups: await listBackups('full'), logs: await listBackupLogs() } });
};

export const downloadBackup = async (req: Request, res: Response) => {
    const filepath = getBackupPath(req.params.filename, 'full');
    if (!fs.existsSync(filepath)) throw new AppError('Backup file not found', 404);
    res.download(filepath, req.params.filename);
};

export const removeBackup = async (req: Request, res: Response) => {
    await deleteBackup(req.params.filename, 'full');
    res.status(200).json({ status: 'success', message: 'Backup deleted successfully' });
};

export const cleanBackups = async (req: Request, res: Response) => {
    const deletedCount = await cleanOldBackups(req.body.retentionDays ?? 30);
    res.status(200).json({ status: 'success', message: `Cleaned ${deletedCount} old backups`, data: { deletedCount } });
};

/** Restores the whole database from a backup (password re-check; a safety backup is taken first). */
export const restoreBackup = async (req: Request, res: Response) => {
    const { filename, confirmPassword } = req.body;
    await verifyPassword(req.user!.id, confirmPassword);
    const filepath = getBackupPath(filename, 'full');
    if (!fs.existsSync(filepath)) throw new AppError('Backup file not found', 404);
    try {
        const safetyBackup = await createFullBackup();
        await restoreFromBackup(filepath);
        await logRestore({ filename, status: 'SUCCESS', userId: req.user!.id });
        res.status(200).json({ status: 'success', message: 'Database restored successfully', data: { restoredFrom: filename, safetyBackup: safetyBackup.filename } });
    } catch (error: any) {
        await logRestore({ filename, status: 'FAILED', error: error.message, userId: req.user!.id }).catch(() => undefined);
        throw error;
    }
};
