import { query } from '../src/config/db';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const migrate = async () => {
    try {
        const sqlPath = path.join(__dirname, '../../database/migrations/001_inventory_schema.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Running migration...');
        await query(sql);
        console.log('Migration successful!');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrate();
