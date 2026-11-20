import { createFullBackup, cleanOldBackups } from '../services/backupService';
import { query } from '../config/db';
import { dayKey, scheduleJob, weekKey } from './runner';

// Automated backup scheduler
export const startBackupScheduler = () => {
    const isEnabled = process.env.BACKUP_AUTO_ENABLED !== 'false';

    if (!isEnabled) {
        console.log('⏸️  Automated backups disabled');
        return;
    }

    // Daily backup at 2:00 AM and weekly cleanup, each on one server only
    const dailySchedule = process.env.BACKUP_SCHEDULE_DAILY || '0 2 * * *';
    scheduleJob('backup', dailySchedule, dayKey, async () => {
        try {
            const backup = await createFullBackup();
            await query(
                `INSERT INTO backup_logs (type, filename, file_size, status, storage_location)
                 VALUES ($1, $2, $3, $4, $5)`,
                ['FULL', backup.filename, backup.size, 'SUCCESS', 'local']
            );
            return { filename: backup.filename, size: backup.size };
        } catch (error: any) {
            await query(
                `INSERT INTO backup_logs (type, status, error_message, storage_location)
                 VALUES ($1, $2, $3, $4)`,
                ['FULL', 'FAILED', error.message, 'local']
            );
            throw error;
        }
    });

    const cleanupSchedule = process.env.BACKUP_CLEANUP_SCHEDULE || '0 3 * * 0';
    scheduleJob('backup-cleanup', cleanupSchedule, weekKey, async () => ({
        deleted: await cleanOldBackups(parseInt(process.env.BACKUP_RETENTION_DAYS || '30')),
    }));

    console.log('✅ Backup scheduler started');
    console.log(`   - Daily backups: ${dailySchedule}`);
    console.log(`   - Weekly cleanup: ${cleanupSchedule}`);
};
