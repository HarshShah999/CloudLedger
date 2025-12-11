
import { query } from '../config/db';

const migrate = async () => {
    try {
        console.log('Running migration: add_state_and_gstin_columns...');

        // 1. Add 'state' to companies
        console.log('Adding state column to companies table...');
        await query(`
            ALTER TABLE companies 
            ADD COLUMN IF NOT EXISTS state VARCHAR(100);
        `);

        // 2. Add 'state' and 'gstin' to ledgers
        console.log('Adding state and gstin columns to ledgers table...');
        await query(`
            ALTER TABLE ledgers 
            ADD COLUMN IF NOT EXISTS state VARCHAR(100),
            ADD COLUMN IF NOT EXISTS gstin VARCHAR(20);
        `);

        console.log('Successfully added columns.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrate();
