import { runAllReminders } from '../services/reminderService';
import { dayKey, scheduleJob } from './runner';

/** Sends payment reminders once a day at 10:00 (India time by default), on one server only. */
export const startReminderJob = () => {
    scheduleJob('reminders', '0 10 * * *', dayKey, () => runAllReminders());
};
