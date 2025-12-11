import cron from 'node-cron';
import { query } from '../config/db';
import { createInvoiceService } from '../controllers/invoiceController';

// Helper to calculate next date
const calculateNextDate = (date: Date, frequency: string): Date => {
    const newDate = new Date(date);
    if (frequency === 'MONTHLY') {
        newDate.setMonth(newDate.getMonth() + 1);
    } else if (frequency === 'QUARTERLY') {
        newDate.setMonth(newDate.getMonth() + 3);
    } else if (frequency === 'YEARLY') {
        newDate.setFullYear(newDate.getFullYear() + 1);
    }
    return newDate;
};

// Run daily at 1:00 AM
export const startRecurringInvoiceJob = () => {
    cron.schedule('0 1 * * *', async () => {
        console.log('Running recurring invoice job...');
        try {
            const today = new Date().toISOString().split('T')[0];

            // Find due recurring invoices
            const dueInvoices = await query(
                `SELECT * FROM recurring_invoices 
                 WHERE is_active = true 
                 AND next_invoice_date <= $1 
                 AND (end_date IS NULL OR end_date >= $1)`,
                [today]
            );

            for (const recurring of dueInvoices.rows) {
                try {
                    // Get items
                    const itemsRes = await query(
                        'SELECT * FROM recurring_invoice_items WHERE recurring_invoice_id = $1',
                        [recurring.id]
                    );

                    // Generate Invoice Number (Simple logic for now, can be enhanced)
                    const countRes = await query('SELECT COUNT(*) FROM invoices WHERE company_id = $1', [recurring.company_id]);
                    const nextNum = parseInt(countRes.rows[0].count) + 1;
                    const invoiceNumber = `${recurring.invoice_number_prefix || 'INV'}-${nextNum}`;

                    // Prepare request-like object for createInvoice logic
                    const invoiceData = {
                        companyId: recurring.company_id,
                        partyLedgerId: recurring.party_ledger_id,
                        salesLedgerId: recurring.sales_ledger_id,
                        invoiceNumber,
                        date: today,
                        dueDate: today, // Or calculate based on terms
                        type: recurring.type,
                        items: itemsRes.rows.map((item: any) => ({
                            itemId: item.item_id,
                            description: item.description,
                            quantity: Number(item.quantity),
                            rate: Number(item.rate),
                            discountPercent: Number(item.discount_percent),
                            taxRate: 18 // Default tax rate if not stored
                        })),
                        notes: recurring.notes,
                        discountPercent: Number(recurring.discount_percent)
                    };

                    // Call service
                    await createInvoiceService(invoiceData);

                    // Update next invoice date
                    const nextDate = calculateNextDate(new Date(recurring.next_invoice_date), recurring.frequency);
                    await query(
                        'UPDATE recurring_invoices SET next_invoice_date = $1 WHERE id = $2',
                        [nextDate.toISOString().split('T')[0], recurring.id]
                    );

                    console.log(`Generated invoice ${invoiceNumber} for recurring template ${recurring.id}`);

                } catch (err) {
                    console.error(`Failed to generate invoice for recurring template ${recurring.id}`, err);
                }
            }
        } catch (error) {
            console.error('Error in recurring invoice job:', error);
        }
    });
};
