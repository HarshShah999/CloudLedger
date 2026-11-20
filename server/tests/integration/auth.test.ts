import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { api, closePool, resetDatabase } from './helpers';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const email = 'cookie@example.com';

/** "name=value" pairs from Set-Cookie, as a browser would send them back. */
const cookiesFrom = (res: any): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const c of (res.headers['set-cookie'] as string[]) ?? []) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        out[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return out;
};
const cookieHeader = (c: Record<string, string>) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ');

let jar: Record<string, string> = {};

beforeAll(async () => {
    await resetDatabase();
    const r = await api().post('/api/auth/register').send({ name: 'Cookie User', email, password: 'password123' });
    jar = cookiesFrom(r);
});

afterAll(closePool);

describe('Browser sessions', () => {
    it('sets httpOnly cookies that page scripts cannot read', async () => {
        const r = await api().post('/api/auth/login').send({ email, password: 'password123' });
        const raw = (r.headers['set-cookie'] as unknown as string[]).join('\n');
        expect(raw).toMatch(/cl_at=[^;]+;.*HttpOnly/);
        expect(raw).toMatch(/cl_rt=[^;]+;.*Path=\/api\/auth;.*HttpOnly/);
        expect(raw).toMatch(/SameSite=Lax/);
        jar = cookiesFrom(r);
    });

    it('authenticates with the cookie, and blocks cookie writes without the anti-forgery header', async () => {
        expect((await api().get('/api/auth/me').set('Cookie', cookieHeader(jar))).status).toBe(200);
        const forged = await api().post('/api/companies').set('Cookie', cookieHeader(jar)).send({ name: 'Evil' });
        expect(forged.status).toBe(403);
        const ok = await api().post('/api/companies').set('Cookie', cookieHeader(jar)).set(XHR).send({
            name: 'Cookie Co', state: 'Maharashtra', financialYear: { name: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31' },
        });
        expect(ok.status).toBe(201);
    });

    it('rotates the refresh token, and treats reuse of an old one as theft', async () => {
        const first = jar.cl_rt;
        const r = await api().post('/api/auth/refresh').set('Cookie', `cl_rt=${first}`).set(XHR);
        expect(r.status).toBe(200);
        const next = cookiesFrom(r);
        expect(next.cl_rt).toBeTruthy();
        expect(next.cl_rt).not.toBe(first);
        expect((await api().get('/api/auth/me').set('Cookie', `cl_at=${next.cl_at}`)).status).toBe(200);

        // Within a few seconds (parallel tab) the old token still gets an access token
        expect((await api().post('/api/auth/refresh').set('Cookie', `cl_rt=${first}`).set(XHR)).status).toBe(200);
        // Later, the same old token means someone copied it: the session is revoked
        await pool.query(`UPDATE sessions SET rotated_at = now() - interval '5 minutes' WHERE prev_token_hash IS NOT NULL`);
        expect((await api().post('/api/auth/refresh').set('Cookie', `cl_rt=${first}`).set(XHR)).status).toBe(401);
        expect((await api().post('/api/auth/refresh').set('Cookie', `cl_rt=${next.cl_rt}`).set(XHR)).status).toBe(401);
        expect((await api().get('/api/auth/me').set('Cookie', `cl_at=${next.cl_at}`)).status).toBe(401);
    });

    it('logs out immediately, server-side', async () => {
        const login = await api().post('/api/auth/login').send({ email, password: 'password123' });
        const c = cookiesFrom(login);
        expect((await api().get('/api/auth/me').set('Cookie', cookieHeader(c))).status).toBe(200);
        const out = await api().post('/api/auth/logout').set('Cookie', cookieHeader(c)).set(XHR);
        expect(out.status).toBe(204);
        expect((out.headers['set-cookie'] as unknown as string[]).join(' ')).toMatch(/cl_at=;/);
        // The old access token is dead even though it has not expired
        expect((await api().get('/api/auth/me').set('Cookie', `cl_at=${c.cl_at}`)).status).toBe(401);
        expect((await api().get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`)).status).toBe(401);
    });

    it('signs out other devices when the password changes', async () => {
        const phone = await api().post('/api/auth/login').send({ email, password: 'password123' });
        const laptop = await api().post('/api/auth/login').send({ email, password: 'password123' });
        const r = await api().put('/api/users/me/password').set('Authorization', `Bearer ${laptop.body.token}`)
            .send({ currentPassword: 'password123', newPassword: 'newpassword456' });
        expect(r.status).toBe(200);
        expect((await api().get('/api/auth/me').set('Authorization', `Bearer ${phone.body.token}`)).status).toBe(401);
        expect((await api().get('/api/auth/me').set('Authorization', `Bearer ${laptop.body.token}`)).status).toBe(200);
    });
});
