import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { verifyToken } from '../utils/authUtils';
import { AppError } from './errorHandler';
import { currentContext } from '../config/requestContext';

/** Requires a valid bearer token for an existing user. */
export const protect = async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) return next(new AppError('Not authorized to access this route', 401));

    let decoded: { id: string };
    try {
        decoded = verifyToken(token);
    } catch {
        return next(new AppError('Session expired, please log in again', 401));
    }

    try {
        const res = await query('SELECT id, role, is_superadmin FROM users WHERE id = $1', [decoded.id]);
        if (res.rows.length === 0) return next(new AppError('User no longer exists', 401));
        const u = res.rows[0];
        req.user = { id: u.id, role: u.role, isSuperadmin: u.is_superadmin };
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
