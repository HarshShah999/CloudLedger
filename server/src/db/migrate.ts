import fs from 'fs';
import path from 'path';
import pool from '../config/db';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');
const LOCK_KEY = 726_001; // arbitrary constant for pg_advisory_lock

/**
 * Applies every database/migrations/*.sql file that has not been applied yet,
 * in filename order. Each file runs in its own transaction on one connection.
 */
export const runMigrations = async (log: (msg: string) => void = console.log): Promise<string[]> => {
    const client = await pool.connect();
    const applied: string[] = [];
    try {
        await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`);

        const done = new Set(
            (await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version)
        );
        const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

        for (const file of files) {
            if (done.has(file)) continue;
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
                await client.query('COMMIT');
                applied.push(file);
                log(`✅ Migration applied: ${file}`);
            } catch (err) {
                await client.query('ROLLBACK');
                throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
            }
        }
        return applied;
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
        client.release();
    }
};

if (require.main === module) {
    runMigrations()
        .then((applied) => {
            console.log(applied.length ? `Applied ${applied.length} migration(s)` : 'Database is up to date');
            return pool.end();
        })
        .catch((err) => {
            console.error(err.message);
            process.exit(1);
        });
}
