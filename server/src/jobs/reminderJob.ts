import cron from 'node-cron';
import { runAllReminders } from '../services/reminderService';

/** Sends payment reminders every day at 10:00 (India time by default). */
export const startReminderJob = () => {
    cron.schedule(
        '0 10 * * *',
        async () => {
            try {
                const r = await runAllReminders();
                if (r.sent || r.failed) console.log(`Reminders: ${r.sent} sent, ${r.failed} failed, ${r.skipped} skipped`);
            } catch (err) {
                console.error('Reminder job failed:', err);
            }
        },
        { timezone: process.env.TZ || 'Asia/Kolkata' }
    );
};
