import { Request, Response, NextFunction } from 'express';
import { query } from '../config/db';
import { AppError } from './errorHandler';

export type CompanyRole = 'admin' | 'accountant' | 'viewer';

const RANK: Record<CompanyRole, number> = { viewer: 1, accountant: 2, admin: 3 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** SQL returning company_id for a resource id ($1). */
const RESOURCE_SQL = {
    invoices: 'SELECT company_id FROM invoices WHERE id = $1',
    vouchers: 'SELECT company_id FROM vouchers WHERE id = $1',
    voucher_entries:
        'SELECT v.company_id FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id WHERE ve.id = $1',
    ledgers: 'SELECT company_id FROM ledgers WHERE id = $1',
    ledger_groups: 'SELECT company_id FROM ledger_groups WHERE id = $1',
    items: 'SELECT company_id FROM items WHERE id = $1',
    units: 'SELECT company_id FROM units WHERE id = $1',
    payments: 'SELECT company_id FROM payments WHERE id = $1',
    receipts: 'SELECT company_id FROM receipts WHERE id = $1',
    recurring_invoices: 'SELECT company_id FROM recurring_invoices WHERE id = $1',
    financial_years: 'SELECT company_id FROM financial_years WHERE id = $1',
} as const;

export type ResourceName = keyof typeof RESOURCE_SQL;

/** Throws AppError unless the user is a member of the company with at least `min` role. */
export const assertCompanyRole = async (
    userId: string | undefined,
    companyId: unknown,
    min: CompanyRole
): Promise<CompanyRole> => {
    if (!userId) throw new AppError('Not authorized', 401);
    if (!isUuid(companyId)) throw new AppError('A valid companyId is required', 400);

    const res = await query('SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2', [
        companyId,
        userId,
    ]);
    if (res.rows.length === 0) throw new AppError('You do not have access to this company', 403);

    const role = (res.rows[0].role in RANK ? res.rows[0].role : 'viewer') as CompanyRole;
    if (RANK[role] < RANK[min]) {
        throw new AppError(`This action requires the ${min} role in this company`, 403);
    }
    return role;
};

const companyIdFromRequest = (req: Request): unknown =>
    req.params.companyId ?? (req.query.companyId as unknown) ?? req.body?.companyId ?? req.header('x-company-id');

/**
 * Verifies membership for the company named in the request
 * (route param, query string, body or X-Company-Id header).
 */
export const requireCompany =
    (min: CompanyRole = 'viewer') =>
    async (req: Request, _res: Response, next: NextFunction) => {
        try {
            const companyId = companyIdFromRequest(req) as string;
            const role = await assertCompanyRole(req.user?.id, companyId, min);
            req.company = { id: companyId, role };
            next();
        } catch (err) {
            next(err);
        }
    };

/**
 * Verifies membership for the company that owns the resource identified by
 * route param `param` (default `id`). Responds 404 if the resource does not exist.
 */
export const requireResource =
    (resource: ResourceName, min: CompanyRole = 'viewer', param = 'id') =>
    async (req: Request, _res: Response, next: NextFunction) => {
        try {
            const id = req.params[param];
            if (!isUuid(id)) throw new AppError('Not found', 404);
            const res = await query(RESOURCE_SQL[resource], [id]);
            if (res.rows.length === 0) throw new AppError('Not found', 404);
            const companyId = res.rows[0].company_id as string;
            const role = await assertCompanyRole(req.user?.id, companyId, min);
            req.company = { id: companyId, role };
            next();
        } catch (err) {
            next(err);
        }
    };

/** Write-access shorthand used by most routes. */
export const canRead = requireCompany('viewer');
export const canWrite = requireCompany('accountant');
export const canAdmin = requireCompany('admin');
