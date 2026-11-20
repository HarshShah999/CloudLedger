import crypto from 'crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';

/**
 * Structured JSON logs (one line per event), ready for any log service.
 * LOG_LEVEL: trace | debug | info | warn | error | silent (default: info; silent in tests).
 * Secrets and personal data in requests are redacted.
 */
export const logger = pino({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    base: { service: 'cloudledger-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.confirmPassword',
            '*.currentPassword',
            '*.newPassword',
            '*.whatsappToken',
            '*.refreshToken',
        ],
        censor: '[redacted]',
    },
});

/**
 * Logs every request with a request id. The id comes from the X-Request-Id header
 * (set by a load balancer) or is generated, and is sent back in the response so
 * a user's problem report can be matched to the server logs.
 */
export const httpLogger = pinoHttp({
    logger,
    genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
    },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    // Large upload bodies and query strings with tokens stay out of the logs
    serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
    },
    autoLogging: { ignore: (req) => (req.url || '').startsWith('/api/health') },
});
