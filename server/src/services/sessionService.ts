import crypto from 'crypto';
import { Request, Response } from 'express';
import { query } from '../config/db';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { generateToken } from '../utils/authUtils';

export const ACCESS_COOKIE = 'cl_at';
export const REFRESH_COOKIE = 'cl_rt';
/** Two tabs refreshing at the same moment both present the old token; that is not theft. */
const REUSE_GRACE_MS = 30 * 1000;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const newRefreshToken = () => crypto.randomBytes(32).toString('base64url');
const refreshExpiry = () => new Date(Date.now() + env.refreshTokenDays * 86400000);

/** Reads one cookie from the request (no cookie-parser dependency needed). */
export const readCookie = (req: Request, name: string): string | undefined => {
    const raw = req.headers.cookie;
    if (!raw) return undefined;
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return undefined;
};

const cookieBase = () => ({ httpOnly: true, secure: env.cookieSecure, sameSite: 'lax' as const });

const setCookies = (res: Response, access: string, refresh: string) => {
    res.cookie(ACCESS_COOKIE, access, { ...cookieBase(), path: '/api', maxAge: env.accessTokenMinutes * 60000 });
    res.cookie(REFRESH_COOKIE, refresh, { ...cookieBase(), path: '/api/auth', maxAge: env.refreshTokenDays * 86400000 });
};

export const clearAuthCookies = (res: Response) => {
    res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: '/api' });
    res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: '/api/auth' });
};

/** Starts a session after login/registration; sets the cookies and returns the access token. */
export const startSession = async (req: Request, res: Response, userId: string) => {
    const refresh = newRefreshToken();
    const s = await query(
        `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [userId, sha256(refresh), refreshExpiry(), String(req.headers['user-agent'] || '').slice(0, 255), req.ip ?? null]
    );
    const access = generateToken(userId, s.rows[0].id);
    setCookies(res, access, refresh);
    return access;
};

/**
 * Exchanges a refresh token for a new access token and a new refresh token.
 * An old (already rotated) token presented again outside the grace period
 * revokes the session: someone else has a copy.
 */
export const refreshSession = async (req: Request, res: Response) => {
    const presented = readCookie(req, REFRESH_COOKIE) || (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '');
    if (!presented) throw new AppError('Not signed in', 401);
    const hash = sha256(presented);

    const current = (await query('SELECT * FROM sessions WHERE token_hash = $1', [hash])).rows[0];
    if (!current) {
        const old = (await query('SELECT * FROM sessions WHERE prev_token_hash = $1', [hash])).rows[0];
        if (old && !old.revoked_at && old.rotated_at && Date.now() - new Date(old.rotated_at).getTime() < REUSE_GRACE_MS) {
            // A parallel tab: give it an access token; its cookie already holds the new refresh token
            const access = generateToken(old.user_id, old.id);
            res.cookie(ACCESS_COOKIE, access, { ...cookieBase(), path: '/api', maxAge: env.accessTokenMinutes * 60000 });
            return { userId: old.user_id, access };
        }
        if (old && !old.revoked_at) {
            await query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'refresh token reused' WHERE id = $1`, [old.id]);
        }
        clearAuthCookies(res);
        throw new AppError('Session expired, please log in again', 401);
    }
    if (current.revoked_at || new Date(current.expires_at).getTime() < Date.now()) {
        clearAuthCookies(res);
        throw new AppError('Session expired, please log in again', 401);
    }

    const refresh = newRefreshToken();
    await query(
        `UPDATE sessions SET prev_token_hash = token_hash, token_hash = $2, rotated_at = now(), last_used_at = now(), expires_at = $3
         WHERE id = $1`,
        [current.id, sha256(refresh), refreshExpiry()]
    );
    const access = generateToken(current.user_id, current.id);
    setCookies(res, access, refresh);
    return { userId: current.user_id, access };
};

export const revokeSession = async (sessionId: string, reason = 'logout') => {
    await query(`UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL`, [sessionId, reason]);
};

/** Signs a user out everywhere (e.g. after a password change), optionally keeping one session. */
export const revokeUserSessions = async (userId: string, exceptSessionId?: string | null, reason = 'password changed') => {
    await query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = $3 WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
        [userId, exceptSessionId ?? null, reason]
    );
};

/** Finds the session behind a request's refresh cookie (for logout without a valid access token). */
export const sessionFromRefreshCookie = async (req: Request): Promise<string | null> => {
    const presented = readCookie(req, REFRESH_COOKIE);
    if (!presented) return null;
    const r = await query('SELECT id FROM sessions WHERE token_hash = $1', [sha256(presented)]);
    return r.rows[0]?.id ?? null;
};
