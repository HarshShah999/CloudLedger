import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { verifyToken } from '../utils/authUtils';
import { AppError } from './errorHandler';
import { currentContext } from '../config/requestContext';
import { ACCESS_COOKIE, readCookie } from '../services/sessionService';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cookies are sent by the browser automatically, so a request that changes data
 * using the cookie must also carry a header other websites cannot add
 * (cross-site requests with custom headers are blocked by CORS).
 */
export const requireCsrfHeader = (req: Request) =>
    SAFE_METHODS.has(req.method) || req.headers['x-requested-with'] === 'XMLHttpRequest';

/**
 * Requires a valid access token for an existing user: from the httpOnly cookie
 * (browser) or an Authorization: Bearer header (API clients). A token tied to a
 * session stops working as soon as that session is logged out.
 */
export const protect = async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const bearer = header && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    const cookie = bearer ? undefined : readCookie(req, ACCESS_COOKIE);
    const token = bearer || cookie;
    if (!token) return next(new AppError('Not authorized to access this route', 401));
    if (cookie && !requireCsrfHeader(req)) return next(new AppError('Request blocked: missing X-Requested-With header', 403));

    let decoded: { id: string; sid?: string };
    try {
        decoded = verifyToken(token);
    } catch {
        return next(new AppError('Session expired, please log in again', 401));
    }

    try {
        const res = await query(
            `SELECT u.id, u.role, u.is_superadmin, s.id AS session_id, s.revoked_at, s.expires_at
             FROM users u LEFT JOIN sessions s ON s.id = $2::uuid AND s.user_id = u.id
             WHERE u.id = $1`,
            [decoded.id, decoded.sid ?? null]
        );
        if (res.rows.length === 0) return next(new AppError('User no longer exists', 401));
        const u = res.rows[0];
        if (decoded.sid && (!u.session_id || u.revoked_at || new Date(u.expires_at).getTime() < Date.now())) {
            return next(new AppError('Session expired, please log in again', 401));
        }
        req.user = { id: u.id, role: u.role, isSuperadmin: u.is_superadmin, sessionId: decoded.sid };
        const ctx = currentContext();
        if (ctx) ctx.userId = u.id;
        next();
    } catch (err) {
        next(err);
    }
};

/** Platform-level operations (full database backup/restore). */
export const requireSuperadmin = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user?.isSuperadmin) {
        return next(new AppError('Only the platform administrator can perform this action', 403));
    }
    next();
};
