
import { query } from '../config/db';

const migrate = async () => {
    try {
        console.log('Adding gstin column to companies table...');
        await query(`
            ALTER TABLE companies 
            ADD COLUMN IF NOT EXISTS gstin VARCHAR(20);
        `);
        console.log('Successfully added gstin column.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrate();
