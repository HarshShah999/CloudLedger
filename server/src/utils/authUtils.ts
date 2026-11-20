import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { env } from '../config/env';

export const generateToken = (userId: string) =>
    jwt.sign({ id: userId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });

export const verifyToken = (token: string) => jwt.verify(token, env.jwtSecret) as { id: string };

export const hashPassword = async (password: string) => bcrypt.hash(password, 12);

export const comparePassword = async (password: string, hash: string) => bcrypt.compare(password, hash);
