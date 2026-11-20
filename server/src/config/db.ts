import { Pool, PoolClient, QueryResult, types } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    max: Number(process.env.DB_POOL_SIZE) || 10,
});

// Postgres returns DATE columns as JS Date objects in local time, which shifts
// dates across timezones. Accounting dates are calendar dates: keep them as
// 'YYYY-MM-DD' strings.
types.setTypeParser(1082, (v: string) => v);

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

/** Anything that can run a query: the pool or a transaction client. */
export interface Queryable {
    query: (text: string, params?: any[]) => Promise<QueryResult<any>>;
}

export const query = (text: string, params?: any[]) => pool.query(text, params);
export const getClient = () => pool.connect();

/**
 * Runs `fn` inside a single database transaction on one dedicated connection.
 * Commits if `fn` resolves, rolls back if it throws. Always use this for
 * multi-statement writes — `query('BEGIN')` on the pool does NOT work because
 * each pool.query may run on a different connection.
 */
export const withTransaction = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    } finally {
        client.release();
    }
};

export default pool;
