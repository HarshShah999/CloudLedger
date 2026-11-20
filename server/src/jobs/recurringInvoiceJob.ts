import { runRecurringInvoices } from '../services/recurringService';
import { dayKey, scheduleJob } from './runner';

/** Generates due recurring invoices daily at 01:00 (and at startup if today's run has not happened). */
export const startRecurringInvoiceJob = () => {
    scheduleJob('recurring-invoices', '0 1 * * *', dayKey, async () => ({ generated: await runRecurringInvoices() }), { runAtStartup: true });
};
