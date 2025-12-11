import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { hashPassword, comparePassword, generateToken } from '../utils/authUtils';
import { AppError } from '../middleware/errorHandler';

export const register = async (req: Request, res: Response, next: NextFunction) => {
    const { name, email, password, role = 'accountant' } = req.body;

    console.log('📝 Registration attempt:', { name, email, role });

    try {
        // Check if user exists
        const userCheck = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (userCheck.rows.length > 0) {
            console.log('❌ User already exists:', email);
            return next(new AppError('User already exists', 400));
        }

        // Hash password
        console.log('🔐 Hashing password...');
        const hashedPassword = await hashPassword(password);

        // Create user with specified role
        console.log('💾 Creating user in database with role:', role);
        const newUser = await query(
            'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
            [name, email, hashedPassword, role]
        );

        const user = newUser.rows[0];
        console.log('✅ User created:', user);

        const token = generateToken(user.id, user.role);

        res.status(201).json({
            status: 'success',
            token,
            data: {
                user,
            },
        });
    } catch (error) {
        console.error('❌ Registration error:', error);
        next(error);
    }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;

    try {
        // Check if user exists
        const result = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return next(new AppError('Invalid email or password', 401));
        }

        const user = result.rows[0];

        // Check password
        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) {
            return next(new AppError('Invalid email or password', 401));
        }

        const token = generateToken(user.id, user.role);

        // Remove password from output
        delete user.password;

        res.status(200).json({
            status: 'success',
            token,
            data: {
                user,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getMe = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await query('SELECT id, name, email, role FROM users WHERE id = $1', [req.user?.id]);

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
