import os from 'os';
import { logger } from './logger';

/**
 * Sends unexpected server errors (5xx, failed jobs) somewhere a person will see them.
 * Set ERROR_WEBHOOK_URL to a Slack/Teams/Google Chat incoming webhook or any
 * endpoint accepting JSON; leave it empty to only log. A tracking service such
 * as Sentry can be plugged in here in one place.
 * At most one alert per distinct message per 10 minutes, so a burst of the same
 * failure does not flood the channel.
 */
const recent = new Map<string, number>();
const THROTTLE_MS = 10 * 60 * 1000;

export const reportError = (err: unknown, context: Record<string, unknown> = {}) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error({ err: e, ...context }, e.message);

    const url = process.env.ERROR_WEBHOOK_URL;
    if (!url) return;
    const key = `${e.message}`.slice(0, 200);
    const now = Date.now();
    if ((recent.get(key) ?? 0) > now - THROTTLE_MS) return;
    recent.set(key, now);

    const summary = `Taalmel error on ${os.hostname()}: ${e.message}`;
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `text` is what Slack/Teams/Chat display; the rest is for other receivers
        body: JSON.stringify({ text: summary, error: e.message, stack: e.stack?.split('\n').slice(0, 8).join('\n'), ...context }),
        signal: AbortSignal.timeout(5000),
    }).catch((sendErr) => logger.warn({ err: sendErr }, 'Could not deliver error alert'));
};
