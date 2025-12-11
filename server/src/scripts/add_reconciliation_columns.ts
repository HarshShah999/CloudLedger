
import { query } from '../config/db';

const migrate = async () => {
    try {
        console.log('Adding reconciliation columns to voucher_entries table...');

        // Add instrument_number
        await query(`
            ALTER TABLE voucher_entries 
            ADD COLUMN IF NOT EXISTS instrument_number VARCHAR(50);
        `);

        // Add instrument_date
        await query(`
            ALTER TABLE voucher_entries 
            ADD COLUMN IF NOT EXISTS instrument_date DATE;
        `);

        // Add bank_allocation_date (Reconciliation Date)
        await query(`
            ALTER TABLE voucher_entries 
            ADD COLUMN IF NOT EXISTS bank_allocation_date DATE;
        `);

        console.log('Successfully added reconciliation columns.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrate();
