import { Request, Response, NextFunction } from 'express';
import { query, withTransaction } from '../config/db';
import { hashPassword, comparePassword } from '../utils/authUtils';
import { AppError } from '../middleware/errorHandler';

/* ---------- Own profile ---------- */

export const updateMe = async (req: Request, res: Response, next: NextFunction) => {
    const { name, email } = req.body;
    try {
        if (email) {
            const clash = await query('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [
                email,
                req.user!.id,
            ]);
            if (clash.rows.length) return next(new AppError('Email is already in use', 400));
        }
        const result = await query(
            `UPDATE users SET name = COALESCE($1, name), email = COALESCE(lower($2), email)
             WHERE id = $3 RETURNING id, name, email, role, is_superadmin`,
            [name || null, email || null, req.user!.id]
        );
        res.status(200).json({ status: 'success', data: { user: result.rows[0] } });
    } catch (error) {
        next(error);
    }
};

export const updatePassword = async (req: Request, res: Response, next: NextFunction) => {
    const { currentPassword, newPassword } = req.body;
    try {
        const result = await query('SELECT password FROM users WHERE id = $1', [req.user!.id]);
        if (!result.rows.length) return next(new AppError('User not found', 404));
        if (!(await comparePassword(currentPassword, result.rows[0].password))) {
            return next(new AppError('Current password is incorrect', 401));
        }
        await query('UPDATE users SET password = $1 WHERE id = $2', [await hashPassword(newPassword), req.user!.id]);
        res.status(200).json({ status: 'success', message: 'Password updated successfully' });
    } catch (error) {
        next(error);
    }
};

/* ---------- Company members (requireCompany sets req.company) ---------- */

export const listMembers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await query(
            `SELECT u.id, u.name, u.email, cu.role, u.created_at
             FROM company_users cu JOIN users u ON u.id = cu.user_id
             WHERE cu.company_id = $1 ORDER BY u.name`,
            [req.company!.id]
        );
        res.status(200).json({ status: 'success', data: { users: result.rows } });
    } catch (error) {
        next(error);
    }
};

/**
 * Adds a person to the company. If no account exists for the email, one is
 * created with the given initial password.
 */
export const addMember = async (req: Request, res: Response, next: NextFunction) => {
    const { name, password, role } = req.body;
    const email = String(req.body.email).trim().toLowerCase();
    const companyId = req.company!.id;

    try {
        const member = await withTransaction(async (client) => {
            let user = (await client.query('SELECT * FROM users WHERE lower(email) = $1', [email])).rows[0];
            if (!user) {
                if (!password) throw new AppError('Password is required to create a new user', 400);
                if (!name) throw new AppError('Name is required to create a new user', 400);
                user = (
                    await client.query(
                        `INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING *`,
                        [name, email, await hashPassword(password), role]
                    )
                ).rows[0];
            }
            const exists = await client.query('SELECT 1 FROM company_users WHERE company_id = $1 AND user_id = $2', [
                companyId,
                user.id,
            ]);
            if (exists.rows.length) throw new AppError('This user is already a member of the company', 400);
            await client.query('INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)', [
                companyId,
                user.id,
                role,
            ]);
            return { id: user.id, name: user.name, email: user.email, role, created_at: user.created_at };
        });
        res.status(201).json({ status: 'success', data: { user: member } });
    } catch (error) {
        next(error);
    }
};

const assertNotLastAdmin = async (client: any, companyId: string, userId: string) => {
    const r = await client.query(
        `SELECT COUNT(*)::int AS n FROM company_users WHERE company_id = $1 AND role = 'admin' AND user_id <> $2`,
        [companyId, userId]
    );
    if (r.rows[0].n === 0) throw new AppError('A company must keep at least one admin', 400);
};

export const updateMember = async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = req.params;
    const { role } = req.body;
    const companyId = req.company!.id;
    try {
        await withTransaction(async (client) => {
            const cur = await client.query('SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2', [
                companyId,
                userId,
            ]);
            if (!cur.rows.length) throw new AppError('Member not found', 404);
            if (cur.rows[0].role === 'admin' && role !== 'admin') await assertNotLastAdmin(client, companyId, userId);
            await client.query('UPDATE company_users SET role = $1 WHERE company_id = $2 AND user_id = $3', [
                role,
                companyId,
                userId,
            ]);
        });
        res.status(200).json({ status: 'success' });
    } catch (error) {
        next(error);
    }
};

export const removeMember = async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = req.params;
    const companyId = req.company!.id;
    try {
        await withTransaction(async (client) => {
            const cur = await client.query('SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2', [
                companyId,
                userId,
            ]);
            if (!cur.rows.length) throw new AppError('Member not found', 404);
            if (cur.rows[0].role === 'admin') await assertNotLastAdmin(client, companyId, userId);
            await client.query('DELETE FROM company_users WHERE company_id = $1 AND user_id = $2', [companyId, userId]);
        });
        res.status(204).send();
    } catch (error) {
        next(error);
    }
};
