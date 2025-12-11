import fs from 'fs';
import path from 'path';
import pool from './config/db';

const runMigration = async () => {
    try {
        const sqlPath = path.join(__dirname, '../../database/migrations/002_invoice_enhancements.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Running migration...');
        await pool.query(sql);
        console.log('Migration completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

runMigration();
