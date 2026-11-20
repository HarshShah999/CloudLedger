import dotenv from 'dotenv';

dotenv.config();

const required = (name: string): string => {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`Missing required environment variable ${name}. See server/.env.example`);
    }
    return value;
};

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32 && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
}

export const env = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT) || 8000,
    clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
    runMigrations: process.env.RUN_MIGRATIONS !== 'false',
};
