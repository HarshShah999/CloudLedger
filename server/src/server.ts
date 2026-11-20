import { env } from './config/env';
import app from './app';
import pool from './config/db';
import { logger } from './config/logger';
import { reportError } from './config/errorReporter';
import { runMigrations } from './db/migrate';
import { startRecurringInvoiceJob } from './jobs/recurringInvoiceJob';
import { startBackupScheduler } from './jobs/backupScheduler';
import { startReminderJob } from './jobs/reminderJob';
import { initializeBackupDirectories } from './services/backupService';

process.on('unhandledRejection', (reason) => reportError(reason, { kind: 'unhandledRejection' }));
process.on('uncaughtException', (err) => {
    reportError(err, { kind: 'uncaughtException' });
    // The process state is unknown after an uncaught exception: let the supervisor restart it
    setTimeout(() => process.exit(1), 1000).unref();
});

const startServer = async () => {
    try {
        await pool.query('SELECT 1');
        logger.info('Database connected');

        if (env.runMigrations) await runMigrations((msg) => logger.info(msg));
        await initializeBackupDirectories();

        const server = app.listen(env.port, () => {
            logger.info({ port: env.port }, 'Server running');
            startRecurringInvoiceJob();
            startBackupScheduler();
            startReminderJob();
        });

        // Deploys and restarts send SIGTERM: finish requests in flight, then close the database pool
        const shutdown = (signal: string) => {
            logger.info({ signal }, 'Shutting down');
            server.close(() => {
                pool.end().finally(() => process.exit(0));
            });
            setTimeout(() => process.exit(1), 15000).unref();
        };
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    } catch (error) {
        logger.fatal({ err: error }, 'Server failed to start');
        process.exit(1);
    }
};

startServer();
