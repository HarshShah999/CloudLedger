import { env } from './config/env';
import app from './app';
import pool from './config/db';
import { runMigrations } from './db/migrate';
import { startRecurringInvoiceJob } from './jobs/recurringInvoiceJob';
import { startBackupScheduler } from './jobs/backupScheduler';
import { initializeBackupDirectories } from './services/backupService';

const startServer = async () => {
    try {
        await pool.query('SELECT 1');
        console.log('✅ Database connected successfully');

        if (env.runMigrations) await runMigrations();
        await initializeBackupDirectories();

        app.listen(env.port, () => {
            console.log(`🚀 Server running on port ${env.port}`);
            startRecurringInvoiceJob();
            startBackupScheduler();
        });
    } catch (error) {
        console.error('❌ Server failed to start:', (error as Error).message);
        process.exit(1);
    }
};

startServer();
