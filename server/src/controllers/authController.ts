import { Request, Response, NextFunction } from 'express';
import { query, withTransaction } from '../config/db';
import { hashPassword, comparePassword } from '../utils/authUtils';
import { AppError } from '../middleware/errorHandler';
import { requireCsrfHeader } from '../middleware/auth';
import {
    clearAuthCookies, refreshSession, revokeSession, revokeUserSessions, sessionFromRefreshCookie, startSession,
} from '../services/sessionService';

const publicUser = (u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    is_superadmin: u.is_superadmin,
});

/**
 * Self sign-up. The client can NOT choose a role: permissions come from
 * company membership (the creator of a company becomes its admin).
 * The very first account on a fresh installation becomes platform super-admin.
 */
export const register = async (req: Request, res: Response, next: NextFunction) => {
    const { name, password } = req.body;
    const email = String(req.body.email).trim().toLowerCase();

    try {
        const hashed = await hashPassword(password);
        const user = await withTransaction(async (client) => {
            const exists = await client.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
            if (exists.rows.length > 0) throw new AppError('An account with this email already exists', 400);

            // Serialise the "first user" check
            await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
            const count = await client.query('SELECT COUNT(*)::int AS n FROM users');
            const isFirst = count.rows[0].n === 0;

            const created = await client.query(
                `INSERT INTO users (name, email, password, role, is_superadmin)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [name, email, hashed, isFirst ? 'admin' : 'accountant', isFirst]
            );
            return created.rows[0];
        });

        const token = await startSession(req, res, user.id);
        res.status(201).json({ status: 'success', token, data: { user: publicUser(user) } });
    } catch (error) {
        next(error);
    }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
    const email = String(req.body.email).trim().toLowerCase();
    const { password } = req.body;

    try {
        const result = await query('SELECT * FROM users WHERE lower(email) = $1', [email]);
        const user = result.rows[0];
        // Same error for unknown email and wrong password (no account enumeration)
        if (!user || !(await comparePassword(password, user.password))) {
            return next(new AppError('Invalid email or password', 401));
        }

        const token = await startSession(req, res, user.id);
        res.status(200).json({ status: 'success', token, data: { user: publicUser(user) } });
    } catch (error) {
        next(error);
    }
};

export const getMe = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await query('SELECT * FROM users WHERE id = $1', [req.user?.id]);
        if (result.rows.length === 0) return next(new AppError('User not found', 404));
        res.status(200).json({ status: 'success', data: { user: publicUser(result.rows[0]) } });
    } catch (error) {
        next(error);
    }
};

/** POST /api/auth/refresh — new access token (and rotated refresh token) from the refresh cookie. */
export const refresh = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!requireCsrfHeader(req)) throw new AppError('Request blocked: missing X-Requested-With header', 403);
        const { access } = await refreshSession(req, res);
        res.json({ status: 'success', token: access });
    } catch (error) {
        next(error);
    }
};

/** POST /api/auth/logout — ends this session on the server and clears the cookies. */
export const logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!requireCsrfHeader(req)) throw new AppError('Request blocked: missing X-Requested-With header', 403);
        const sid = await sessionFromRefreshCookie(req);
        if (sid) await revokeSession(sid);
        clearAuthCookies(res);
        res.status(204).send();
    } catch (error) {
        next(error);
    }
};

/** POST /api/auth/logout-all — signs this user out on every device. */
export const logoutAll = async (req: Request, res: Response, next: NextFunction) => {
    try {
        await revokeUserSessions(req.user!.id, null, 'signed out everywhere');
        clearAuthCookies(res);
        res.status(204).send();
    } catch (error) {
        next(error);
    }
};
