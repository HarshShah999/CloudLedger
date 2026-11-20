import { Request, Response, NextFunction } from 'express';
import { reportError } from '../config/errorReporter';

export class AppError extends Error {
    statusCode: number;
    status: string;
    isOperational: boolean;

    constructor(message: string, statusCode: number) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

/** Turns common PostgreSQL errors into friendly 4xx responses. */
const fromPostgres = (err: any): AppError | null => {
    switch (err?.code) {
        case '23505': {
            const names: Record<string, string> = {
                uq_ledgers_company_name: 'A ledger with this name already exists',
                uq_items_company_name: 'An item with this name already exists',
                uq_ledger_groups_company_name: 'A group with this name already exists',
                uq_units_company_symbol: 'A unit with this symbol already exists',
                uq_invoice_number: 'This number is already used',
            };
            return new AppError(names[err.constraint] ?? 'This record already exists (duplicate value)', 409);
        }
        case '23503':
            return new AppError('This record is linked to other data and cannot be changed or removed', 400);
        case '22P02':
            return new AppError('Invalid identifier or value in request', 400);
        case '22007':
        case '22008':
            return new AppError('Invalid date', 400);
        case '23514':
            // Raised by the voucher balance check: the message says what is wrong
            return new AppError(/not balanced|does not match/.test(err.message) ? err.message : 'Value not allowed', 400);
        default:
            return null;
    }
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.too.large') err = new AppError('Request is too large', 413);
    if (err?.type === 'entity.parse.failed') err = new AppError('Malformed JSON body', 400);
    const mapped = err instanceof AppError ? err : fromPostgres(err);
    const statusCode = mapped?.statusCode ?? 500;

    if (statusCode >= 500) reportError(err, { requestId: (req as any).id, method: req.method, path: req.originalUrl?.split('?')[0] });

    const body: Record<string, unknown> = {
        status: mapped?.status ?? 'error',
        message: mapped?.message ?? 'Something went wrong. Please try again.',
    };
    if (process.env.NODE_ENV === 'development' && !mapped) body.detail = err?.message;
    res.status(statusCode).json(body);
};
