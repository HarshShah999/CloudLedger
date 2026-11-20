import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../src/config/db';
import { reportError } from '../../src/config/errorReporter';
import { api, closePool, resetDatabase } from './helpers';

beforeAll(resetDatabase);
afterAll(closePool);

describe('Health checks', () => {
    it('reports liveness, readiness and details', async () => {
        expect((await api().get('/api/health/live')).body).toEqual({ status: 'ok' });
        const ready = await api().get('/api/health/ready');
        expect(ready.status).toBe(200);
        expect(ready.body.database.ok).toBe(true);

        await pool.query(`INSERT INTO job_runs (name, run_key, status, error, finished_at) VALUES ('reminders', '2026-11-20', 'FAILED', 'SMTP down', now())`);
        const h = await api().get('/api/health');
        expect(h.status).toBe(200);
        expect(h.body).toMatchObject({ status: 'degraded', failedJobs: ['reminders'], database: { ok: true } });
        expect(h.body.jobs[0]).toMatchObject({ name: 'reminders', status: 'FAILED', error: 'SMTP down' });
    });
});

describe('Request ids', () => {
    it('echoes a caller-supplied id, or generates one', async () => {
        const mine = await api().get('/api/health/live').set('X-Request-Id', 'lb-1234567890');
        expect(mine.headers['x-request-id']).toBe('lb-1234567890');
        const gen = await api().get('/api/health/live');
        expect(gen.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
        // Unsafe ids are replaced, not echoed
        const bad = await api().get('/api/health/live').set('X-Request-Id', '<script>');
        expect(bad.headers['x-request-id']).not.toBe('<script>');
    });
});

describe('Error alerts', () => {
    it('posts server errors to the configured webhook, once per burst', async () => {
        const received: any[] = [];
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
                received.push(JSON.parse(body));
                res.end('ok');
            });
        });
        await new Promise<void>((r) => server.listen(0, r));
        process.env.ERROR_WEBHOOK_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
        try {
            reportError(new Error('Disk is full'), { job: 'backup' });
            reportError(new Error('Disk is full'), { job: 'backup' });
            await new Promise((r) => setTimeout(r, 300));
            expect(received).toHaveLength(1);
            expect(received[0]).toMatchObject({ error: 'Disk is full', job: 'backup' });
            expect(received[0].text).toMatch(/CloudLedger error on .*: Disk is full/);
        } finally {
            delete process.env.ERROR_WEBHOOK_URL;
            server.close();
        }
    });
});
