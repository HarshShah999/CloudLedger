import { Pool, PoolClient, QueryResult, types } from 'pg';
import dotenv from 'dotenv';
import { currentContext } from './requestContext';
import { logger } from './logger';

dotenv.config();

/**
 * Connection settings: DATABASE_URL (hosted databases such as Neon, Supabase,
 * DigitalOcean) or the separate DB_* variables (local development).
 * SSL is used when DB_SSL=true or the URL says sslmode=require; set
 * DB_SSL_REJECT_UNAUTHORIZED=false only for providers with a private certificate authority.
 */
const connectionUrl = process.env.DATABASE_URL;
const wantsSsl = process.env.DB_SSL === 'true' || /sslmode=(require|verify-ca|verify-full)/.test(connectionUrl || '');
const ssl = wantsSsl ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined;

const pool = new Pool({
    ...(connectionUrl
        ? // sslmode in the URL would override the ssl option below, so it is taken out
          { connectionString: connectionUrl.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '') }
        : {
              user: process.env.DB_USER,
              password: process.env.DB_PASSWORD,
              host: process.env.DB_HOST,
              port: parseInt(process.env.DB_PORT || '5432'),
              database: process.env.DB_NAME,
          }),
    ssl,
    max: Number(process.env.DB_POOL_SIZE) || 10,
});

// Postgres returns DATE columns as JS Date objects in local time, which shifts
// dates across timezones. Accounting dates are calendar dates: keep them as
// 'YYYY-MM-DD' strings.
types.setTypeParser(1082, (v: string) => v);

pool.on('error', (err) => {
    logger.error({ err: err }, 'Unexpected error on idle client');
});

/** Anything that can run a query: the pool or a transaction client. */
export interface Queryable {
    query: (text: string, params?: any[]) => Promise<QueryResult<any>>;
}

const WRITE_RE = /^\s*(insert|update|delete)\b/i;

/** Tags the transaction with the acting user so audit triggers can record who changed what. */
const setAuditContext = async (client: PoolClient) => {
    const ctx = currentContext();
    if (!ctx?.userId && !ctx?.ip) return;
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.ip', $2, true)", [
        ctx.userId ?? '',
        ctx.ip ?? '',
    ]);
};

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
        await setAuditContext(client);
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

/**
 * Runs a single statement. Writes made during a user's request run in a short
 * transaction carrying the user id, so the audit trail always knows who acted.
 */
export const query = (text: string, params?: any[]): Promise<QueryResult<any>> => {
    if (WRITE_RE.test(text) && currentContext()?.userId) {
        return withTransaction((client) => client.query(text, params));
    }
    return pool.query(text, params);
};
export const getClient = () => pool.connect();

export default pool;
