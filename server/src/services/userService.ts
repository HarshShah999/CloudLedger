/** Users: own profile, password, and company membership. */
import { query, withTransaction, Queryable } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import { comparePassword, hashPassword } from '../utils/authUtils';
import { revokeUserSessions } from './sessionService';

export type MemberRole = 'admin' | 'accountant' | 'viewer';

/* ---------- Own profile ---------- */

export const updateProfile = async (userId: string, input: { name?: string; email?: string }) => {
    if (input.email) {
        const clash = await query('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [input.email, userId]);
        if (clash.rows.length) throw new AppError('Email is already in use', 400);
    }
    return (
        await query(
            `UPDATE users SET name = COALESCE($1, name), email = COALESCE(lower($2), email)
             WHERE id = $3 RETURNING id, name, email, role, is_superadmin`,
            [input.name || null, input.email || null, userId]
        )
    ).rows[0];
};

/** Changes the password and signs out every other session that used the old one. */
export const changePassword = async (userId: string, currentPassword: string, newPassword: string, keepSessionId?: string | null) => {
    const r = await query('SELECT password FROM users WHERE id = $1', [userId]);
    if (!r.rows.length) throw new AppError('User not found', 404);
    if (!(await comparePassword(currentPassword, r.rows[0].password))) throw new AppError('Current password is incorrect', 401);
    await query('UPDATE users SET password = $1 WHERE id = $2', [await hashPassword(newPassword), userId]);
    await revokeUserSessions(userId, keepSessionId ?? null);
};

/* ---------- Company members ---------- */

export const listMembers = async (companyId: string) =>
    (
        await query(
            `SELECT u.id, u.name, u.email, cu.role, u.created_at
             FROM company_users cu JOIN users u ON u.id = cu.user_id
             WHERE cu.company_id = $1 ORDER BY u.name`,
            [companyId]
        )
    ).rows;

/** Adds a person to the company; creates the account with the given password if none exists. */
export const addMember = (companyId: string, input: { email: string; name?: string; password?: string; role: MemberRole }) =>
    withTransaction(async (db) => {
        const email = String(input.email).trim().toLowerCase();
        let user = (await db.query('SELECT * FROM users WHERE lower(email) = $1', [email])).rows[0];
        if (!user) {
            if (!input.password) throw new AppError('Password is required to create a new user', 400);
            if (!input.name) throw new AppError('Name is required to create a new user', 400);
            user = (
                await db.query(`INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING *`, [
                    input.name, email, await hashPassword(input.password), input.role,
                ])
            ).rows[0];
        }
        const exists = await db.query('SELECT 1 FROM company_users WHERE company_id = $1 AND user_id = $2', [companyId, user.id]);
        if (exists.rows.length) throw new AppError('This user is already a member of the company', 400);
        await db.query('INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)', [companyId, user.id, input.role]);
        return { id: user.id, name: user.name, email: user.email, role: input.role, created_at: user.created_at };
    });

const assertNotLastAdmin = async (db: Queryable, companyId: string, userId: string) => {
    const r = await db.query(
        `SELECT COUNT(*)::int AS n FROM company_users WHERE company_id = $1 AND role = 'admin' AND user_id <> $2`,
        [companyId, userId]
    );
    if (r.rows[0].n === 0) throw new AppError('A company must keep at least one admin', 400);
};

const memberRole = async (db: Queryable, companyId: string, userId: string) => {
    const r = await db.query('SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2', [companyId, userId]);
    if (!r.rows.length) throw new AppError('Member not found', 404);
    return r.rows[0].role as MemberRole;
};

export const updateMemberRole = (companyId: string, userId: string, role: MemberRole) =>
    withTransaction(async (db) => {
        if ((await memberRole(db, companyId, userId)) === 'admin' && role !== 'admin') await assertNotLastAdmin(db, companyId, userId);
        await db.query('UPDATE company_users SET role = $1 WHERE company_id = $2 AND user_id = $3', [role, companyId, userId]);
    });

export const removeMember = (companyId: string, userId: string) =>
    withTransaction(async (db) => {
        if ((await memberRole(db, companyId, userId)) === 'admin') await assertNotLastAdmin(db, companyId, userId);
        await db.query('DELETE FROM company_users WHERE company_id = $1 AND user_id = $2', [companyId, userId]);
    });

/* ---------- Accounts ---------- */

export const publicUser = (u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, is_superadmin: u.is_superadmin });

/**
 * Self sign-up. The client cannot choose a role: permissions come from company
 * membership. The very first account on a fresh installation is the platform super-admin.
 */
export const registerAccount = async (input: { name: string; email: string; password: string }) => {
    const email = String(input.email).trim().toLowerCase();
    const hashed = await hashPassword(input.password);
    return withTransaction(async (db) => {
        const exists = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
        if (exists.rows.length > 0) throw new AppError('An account with this email already exists', 400);
        // Serialise the "first user" check
        await db.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
        const isFirst = (await db.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n === 0;
        return (
            await db.query(`INSERT INTO users (name, email, password, role, is_superadmin) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [
                input.name, email, hashed, isFirst ? 'admin' : 'accountant', isFirst,
            ])
        ).rows[0];
    });
};

/** Checks email and password; the same error for both (no account enumeration). */
export const authenticate = async (emailRaw: string, password: string) => {
    const user = (await query('SELECT * FROM users WHERE lower(email) = $1', [String(emailRaw).trim().toLowerCase()])).rows[0];
    if (!user || !(await comparePassword(password, user.password))) throw new AppError('Invalid email or password', 401);
    return user;
};

export const getUser = async (id: string) => {
    const r = await query('SELECT * FROM users WHERE id = $1', [id]);
    if (!r.rows.length) throw new AppError('User not found', 404);
    return r.rows[0];
};

/** Re-checks the signed-in user's password before a dangerous action (e.g. restoring a backup). */
export const verifyPassword = async (userId: string, password: string) => {
    const r = await query('SELECT password FROM users WHERE id = $1', [userId]);
    if (!r.rows.length || !(await comparePassword(password, r.rows[0].password))) throw new AppError('Invalid password confirmation', 401);
};
