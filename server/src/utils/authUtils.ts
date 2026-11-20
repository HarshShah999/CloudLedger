import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { env } from '../config/env';

/** Short-lived access token; `sid` ties it to a login session so logout takes effect at once. */
export const generateToken = (userId: string, sessionId?: string) =>
    jwt.sign(sessionId ? { id: userId, sid: sessionId } : { id: userId }, env.jwtSecret, { expiresIn: `${env.accessTokenMinutes}m` });

export const verifyToken = (token: string) => jwt.verify(token, env.jwtSecret) as { id: string; sid?: string };

export const hashPassword = async (password: string) => bcrypt.hash(password, 12);

export const comparePassword = async (password: string, hash: string) => bcrypt.compare(password, hash);
