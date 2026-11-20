import 'express';

declare module 'express-serve-static-core' {
    interface Request {
        user?: {
            id: string;
            role: string;
            isSuperadmin?: boolean;
            /** Login session behind the access token, when there is one */
            sessionId?: string;
        };
        /** Set by company access middleware once membership is verified. */
        company?: {
            id: string;
            role: 'admin' | 'accountant' | 'viewer';
        };
    }
}
