import cron from 'node-cron';
import { createFullBackup, cleanOldBackups } from '../services/backupService';
import { query } from '../config/db';

// Automated backup scheduler
export const startBackupScheduler = () => {
    const isEnabled = process.env.BACKUP_AUTO_ENABLED !== 'false';

    if (!isEnabled) {
        console.log('⏸️  Automated backups disabled');
        return;
    }

    // Daily backup at 2:00 AM
    const dailySchedule = process.env.BACKUP_SCHEDULE_DAILY || '0 2 * * *';
    cron.schedule(dailySchedule, async () => {
        console.log('🔄 Running scheduled daily backup...');
        try {
            const backup = await createFullBackup();

            // Log to database
            await query(
                `INSERT INTO backup_logs (type, filename, file_size, status, storage_location)
                 VALUES ($1, $2, $3, $4, $5)`,
                ['FULL', backup.filename, backup.size, 'SUCCESS', 'local']
            );

            console.log(`✅ Scheduled backup completed: ${backup.filename}`);
        } catch (error: any) {
            console.error('❌ Scheduled backup failed:', error);

            // Log failure
            await query(
                `INSERT INTO backup_logs (type, status, error_message, storage_location)
                 VALUES ($1, $2, $3, $4)`,
                ['FULL', 'FAILED', error.message, 'local']
            );
        }
    });

    // Weekly cleanup on Sunday at 3:00 AM
    const cleanupSchedule = process.env.BACKUP_CLEANUP_SCHEDULE || '0 3 * * 0';
    cron.schedule(cleanupSchedule, async () => {
        console.log('🧹 Running scheduled backup cleanup...');
        try {
            const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30');
            const deletedCount = await cleanOldBackups(retentionDays);
            console.log(`✅ Cleanup completed: Deleted ${deletedCount} old backups`);
        } catch (error) {
            console.error('❌ Backup cleanup failed:', error);
        }
    });

    console.log('✅ Backup scheduler started');
    console.log(`   - Daily backups: ${dailySchedule}`);
    console.log(`   - Weekly cleanup: ${cleanupSchedule}`);
};
