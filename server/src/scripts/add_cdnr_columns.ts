
import { query } from '../config/db';

const migrate = async () => {
    try {
        console.log('Running migration: add_cdnr_columns...');

        await query(`
            ALTER TABLE invoices 
            ADD COLUMN IF NOT EXISTS original_invoice_number VARCHAR(50),
            ADD COLUMN IF NOT EXISTS original_invoice_date DATE;
        `);

        // Add DEBIT_NOTE and CREDIT_NOTE to voucher_types?
        // Usually handled dynamically by 'name' check in controller, but ensures vouchers table references are consistent.

        console.log('Successfully added original_invoice columns.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrate();
