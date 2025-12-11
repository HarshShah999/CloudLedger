import app from './app';
import pool from './config/db';
import { startRecurringInvoiceJob } from './jobs/recurringInvoiceJob';
import { startBackupScheduler } from './jobs/backupScheduler';
import { initializeBackupDirectories } from './services/backupService';

const PORT = process.env.PORT || 8000;

const startServer = async () => {
    try {
        // Test DB connection
        await pool.query('SELECT NOW()');
        console.log('✅ Database connected successfully');

        // Initialize backup directories
        await initializeBackupDirectories();

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            startRecurringInvoiceJob();
            startBackupScheduler();
        });
    } catch (error) {
        console.error('❌ Database connection failed', error);
        process.exit(1);
    }
};

startServer();
