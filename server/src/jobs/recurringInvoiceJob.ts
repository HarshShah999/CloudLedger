import cron from 'node-cron';
import { runRecurringInvoices } from '../services/recurringService';

/** Generates due recurring invoices daily at 01:00 and once at startup. */
export const startRecurringInvoiceJob = () => {
    const run = async () => {
        try {
            const n = await runRecurringInvoices();
            if (n) console.log(`🔁 Generated ${n} recurring invoice(s)`);
        } catch (err) {
            console.error('Recurring invoice job failed:', err);
        }
    };
    cron.schedule('0 1 * * *', run, { timezone: process.env.TZ || 'Asia/Kolkata' });
    void run();
};
