import { Request, Response, NextFunction } from 'express';
import { authenticate, getUser, publicUser, registerAccount } from '../services/userService';
import { AppError } from '../middleware/errorHandler';
import { requireCsrfHeader } from '../middleware/auth';
import { checkResetLink, requestPasswordReset, resetPassword } from '../services/passwordResetService';
import {
    clearAuthCookies, refreshSession, revokeSession, revokeUserSessions, sessionFromRefreshCookie, startSession,
} from '../services/sessionService';

/** POST /api/auth/register — creates the account and signs it in. */
export const register = async (req: Request, res: Response) => {
    const user = await registerAccount(req.body);
    const token = await startSession(req, res, user.id);
    res.status(201).json({ status: 'success', token, data: { user: publicUser(user) } });
};

/** POST /api/auth/login */
export const login = async (req: Request, res: Response) => {
    const user = await authenticate(req.body.email, req.body.password);
    const token = await startSession(req, res, user.id);
    res.status(200).json({ status: 'success', token, data: { user: publicUser(user) } });
};

export const getMe = async (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', data: { user: publicUser(await getUser(req.user!.id)) } });
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

/** POST /api/auth/forgot-password { email } — same answer whether or not the account exists. */
export const forgotPassword = async (req: Request, res: Response) => {
    await requestPasswordReset(req.body.email, req.ip);
    res.json({ status: 'success', message: 'If this email is registered, we have sent a link to reset the password. It expires in 30 minutes.' });
};

/** GET /api/auth/reset-password/:token — whether a reset link can still be used. */
export const getResetLink = async (req: Request, res: Response) => {
    res.json({ status: 'success', data: await checkResetLink(String(req.params.token)) });
};

/** POST /api/auth/reset-password { token, password } */
export const postResetPassword = async (req: Request, res: Response) => {
    await resetPassword(req.body.token, req.body.password);
    clearAuthCookies(res);
    res.json({ status: 'success', message: 'Your password has been changed. Please sign in with the new password.' });
};
