import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { capturedMail } from '../../src/services/mailer';
import { api, auth, closePool, createCompany, registerUser, resetDatabase } from './helpers';

let owner: { token: string; email: string };
let companyId: string;
const memberEmail = 'member.reset@example.com';

/** Waits for the next email to an address (reset emails are sent in the background). */
const mailTo = async (to: string, subject: RegExp, after = 0) => {
    for (let i = 0; i < 50; i++) {
        const m = capturedMail.slice(after).find((x) => x.to === to && subject.test(x.subject));
        if (m) return m;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`No email to ${to} matching ${subject}`);
};
const tokenFrom = (mail: any) => /reset-password\?token=([\w-]+)/.exec(mail.text)![1];

beforeAll(async () => {
    await resetDatabase();
    owner = await registerUser('Owner');
    ({ id: companyId } = await createCompany(owner.token));
    await api().post(`/api/companies/${companyId}/members`).set(auth(owner.token))
        .send({ companyId, email: memberEmail, name: 'Meera Member', password: 'original123', role: 'accountant' });
});

afterAll(closePool);

describe('Forgot password', () => {
    it('gives the same answer for unknown emails and sends nothing', async () => {
        const before = capturedMail.length;
        const known = await api().post('/api/auth/forgot-password').send({ email: owner.email });
        const unknown = await api().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
        expect(unknown.status).toBe(200);
        expect(unknown.body).toEqual(known.body);
        await mailTo(owner.email, /Reset your Taalmel password/, before);
        await new Promise((r) => setTimeout(r, 100));
        expect(capturedMail.slice(before).some((m) => m.to === 'nobody@example.com')).toBe(false);
    });

    it('resets the password with the emailed link, once, and signs out everywhere', async () => {
        const before = capturedMail.length;
        const session = await api().post('/api/auth/login').send({ email: memberEmail, password: 'original123' });
        expect(session.status).toBe(200);

        await api().post('/api/auth/forgot-password').send({ email: memberEmail.toUpperCase() });
        const mail = await mailTo(memberEmail, /Reset your Taalmel password/, before);
        expect(mail.html).toContain('Set a new password');
        expect(mail.text).toMatch(/expires in 30 minutes/);
        const token = tokenFrom(mail);
        // Only the hash is stored
        expect((await pool.query('SELECT COUNT(*)::int n FROM password_resets WHERE token_hash = $1', [token])).rows[0].n).toBe(0);

        const check = await api().get(`/api/auth/reset-password/${token}`);
        // The page shows which account it is for, masked: me**********@example.com
        expect(check.body.data).toEqual({ valid: true, email: 'me**********@example.com' });

        expect((await api().post('/api/auth/reset-password').send({ token, password: 'short' })).status).toBe(400);
        const ok = await api().post('/api/auth/reset-password').send({ token, password: 'brandnew456' });
        expect(ok.status).toBe(200);
        await mailTo(memberEmail, /password was changed/, before);

        // Old password and old sessions are dead; the new password works
        expect((await api().post('/api/auth/login').send({ email: memberEmail, password: 'original123' })).status).toBe(401);
        expect((await api().get('/api/auth/me').set(auth(session.body.token))).status).toBe(401);
        expect((await api().post('/api/auth/login').send({ email: memberEmail, password: 'brandnew456' })).status).toBe(200);

        // The link cannot be used again
        expect((await api().get(`/api/auth/reset-password/${token}`)).body.data.valid).toBe(false);
        const again = await api().post('/api/auth/reset-password').send({ token, password: 'another789' });
        expect(again.status).toBe(400);
        expect(again.body.message).toMatch(/expired or was already used/);
    });

    it('only the newest link works, links expire, and requests are limited', async () => {
        const before = capturedMail.length;
        await api().post('/api/auth/forgot-password').send({ email: owner.email });
        const first = tokenFrom(await mailTo(owner.email, /Reset/, before));
        const mid = capturedMail.length;
        await api().post('/api/auth/forgot-password').send({ email: owner.email });
        const second = tokenFrom(await mailTo(owner.email, /Reset/, mid));
        expect((await api().get(`/api/auth/reset-password/${first}`)).body.data.valid).toBe(false);
        expect((await api().get(`/api/auth/reset-password/${second}`)).body.data.valid).toBe(true);

        await pool.query(`UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL`);
        expect((await api().post('/api/auth/reset-password').send({ token: second, password: 'whatever123' })).status).toBe(400);

        // Three emails an hour per account (the owner has had three); a fourth is silently not sent
        const last = capturedMail.length;
        const r = await api().post('/api/auth/forgot-password').send({ email: owner.email });
        expect(r.status).toBe(200);
        await new Promise((res) => setTimeout(res, 200));
        expect(capturedMail.slice(last).some((m) => m.to === owner.email)).toBe(false);
    });

    it('lets a company admin email a reset link to a member, but not other people', async () => {
        const memberId = (await pool.query('SELECT id FROM users WHERE email = $1', [memberEmail])).rows[0].id;
        await pool.query('DELETE FROM password_resets WHERE user_id = $1', [memberId]);
        const before = capturedMail.length;
        const r = await api().post(`/api/companies/${companyId}/members/${memberId}/password-reset`).set(auth(owner.token)).send({});
        expect(r.status).toBe(200);
        expect(r.body.message).toContain(memberEmail);
        const mail = await mailTo(memberEmail, /Reset/, before);
        expect(mail.text).toMatch(/an admin of your company/);

        // The member (an accountant) cannot do it for the owner
        const memberLogin = await api().post('/api/auth/login').send({ email: memberEmail, password: 'brandnew456' });
        const ownerId = (await pool.query('SELECT id FROM users WHERE email = $1', [owner.email])).rows[0].id;
        expect((await api().post(`/api/companies/${companyId}/members/${ownerId}/password-reset`).set(auth(memberLogin.body.token)).send({})).status).toBe(403);
        // Someone outside the company is not found
        const outsider = await registerUser('Outsider');
        const outsiderId = (await pool.query('SELECT id FROM users WHERE email = $1', [outsider.email])).rows[0].id;
        expect((await api().post(`/api/companies/${companyId}/members/${outsiderId}/password-reset`).set(auth(owner.token)).send({})).status).toBe(404);
    });
});
