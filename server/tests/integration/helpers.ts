import request from 'supertest';
import app from '../../src/app';
import pool from '../../src/config/db';
import { runMigrations } from '../../src/db/migrate';

export const api = () => request(app);

/** Wipes the test database and applies all migrations. Refuses to touch a non-test DB. */
export const resetDatabase = async () => {
    if (!/test/i.test(process.env.DB_NAME || '')) throw new Error('Refusing to reset a non-test database');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(() => undefined);
};

let counter = 0;

export const registerUser = async (name = 'User') => {
    counter++;
    const email = `user${counter}-${Date.now()}@example.com`;
    const res = await api().post('/api/auth/register').send({ name, email, password: 'password123' });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { token: res.body.token as string, user: res.body.data.user, email };
};

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export const createCompany = async (token: string, state = 'Maharashtra') => {
    const res = await api()
        .post('/api/companies')
        .set(auth(token))
        .send({
            name: 'Acme Traders',
            state,
            gstin: '27ABCDE1234F1Z5',
            financialYear: { name: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31' },
        });
    if (res.status !== 201) throw new Error(`company failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.company as { id: string };
};

export const groupId = async (token: string, companyId: string, name: string) => {
    const res = await api().get('/api/ledgers/groups').query({ companyId }).set(auth(token));
    const g = res.body.data.groups.find((x: any) => x.name === name);
    if (!g) throw new Error(`group ${name} not found`);
    return g.id as string;
};

export const ledgerByName = async (token: string, companyId: string, name: string) => {
    const res = await api().get('/api/ledgers').query({ companyId }).set(auth(token));
    return res.body.data.ledgers.find((l: any) => l.name === name);
};

export const createLedger = async (token: string, companyId: string, name: string, group: string, extra: object = {}) => {
    const res = await api()
        .post('/api/ledgers')
        .set(auth(token))
        .send({ companyId, name, groupId: await groupId(token, companyId, group), ...extra });
    if (res.status !== 201) throw new Error(`ledger failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.ledger as { id: string };
};

export const closePool = () => pool.end();
