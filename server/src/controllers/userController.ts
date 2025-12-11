import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { hashPassword } from '../utils/authUtils';
import { AppError } from '../middleware/errorHandler';

// Get all users (admin only)
export const getUsers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await query(
            'SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC'
        );

        res.status(200).json({
            status: 'success',
            data: {
                users: result.rows,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Create new user (admin only)
export const createUser = async (req: Request, res: Response, next: NextFunction) => {
    const { name, email, password, role } = req.body;

    try {
        // Check if user exists
        const userCheck = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (userCheck.rows.length > 0) {
            return next(new AppError('User already exists', 400));
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create user
        const newUser = await query(
            'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
            [name, email, hashedPassword, role || 'viewer']
        );

        res.status(201).json({
            status: 'success',
            data: {
                user: newUser.rows[0],
            },
        });
    } catch (error) {
        next(error);
    }
};

// Update user (admin or self)
export const updateUser = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { name, email, role } = req.body;

    try {
        // Check if user can update (admin or self)
        if (req.user?.role !== 'admin' && req.user?.id !== id) {
            return next(new AppError('You do not have permission to update this user', 403));
        }

        // Only admin can change role
        if (role && req.user?.role !== 'admin') {
            return next(new AppError('Only admins can change user roles', 403));
        }

        const updateFields = [];
        const values = [];
        let paramCount = 1;

        if (name) {
            updateFields.push(`name = $${paramCount++}`);
            values.push(name);
        }
        if (email) {
            updateFields.push(`email = $${paramCount++}`);
            values.push(email);
        }
        if (role && req.user?.role === 'admin') {
            updateFields.push(`role = $${paramCount++}`);
            values.push(role);
        }

        values.push(id);

        const result = await query(
            `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING id, name, email, role, created_at`,
            values
        );

        if (result.rows.length === 0) {
            return next(new AppError('User not found', 404));
        }

        res.status(200).json({
            status: 'success',
            data: {
                user: result.rows[0],
            },
        });
    } catch (error) {
        next(error);
    }
};

// Delete user (admin only)
export const deleteUser = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    try {
        // Prevent deleting self
        if (req.user?.id === id) {
            return next(new AppError('You cannot delete your own account', 400));
        }

        const result = await query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return next(new AppError('User not found', 404));
        }

        res.status(204).json({
            status: 'success',
            data: null,
        });
    } catch (error) {
        next(error);
    }
};

// Update password
export const updatePassword = async (req: Request, res: Response, next: NextFunction) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user?.id;

    try {
        // Get current user with password
        const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            return next(new AppError('User not found', 404));
        }

        const user = result.rows[0];

        // Verify current password
        const bcrypt = require('bcrypt');
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return next(new AppError('Current password is incorrect', 401));
        }

        // Hash new password
        const hashedPassword = await hashPassword(newPassword);

        // Update password
        await query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);

        res.status(200).json({
            status: 'success',
            message: 'Password updated successfully',
        });
    } catch (error) {
        next(error);
    }
};
