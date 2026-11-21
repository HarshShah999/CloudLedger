/**
 * Forgot password: a one-time link sent by email.
 *
 * - The response never reveals whether an email has an account.
 * - Only a hash of the token is stored; links expire after 30 minutes and work once.
 * - A new request cancels earlier links; at most 3 emails per account per hour.
 * - Setting the new password signs the user out everywhere and sends a notice.
 */
import crypto from 'crypto';
import { query, withTransaction } from '../config/db';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { hashPassword } from '../utils/authUtils';
import { escapeHtml, sendMail } from './mailer';
import { revokeUserSessions } from './sessionService';
import { publicAppUrl } from './shareService';

const LINK_MINUTES = 30;
const MAX_PER_HOUR = 3;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const emailHtml = (paragraphs: string[], button?: { href: string; label: string }) => `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a;line-height:1.5">
  <h2 style="color:#4338ca;margin-bottom:16px">CloudLedger</h2>
  ${paragraphs.map((p) => `<p>${p}</p>`).join('')}
  ${button ? `<p style="margin:24px 0"><a href="${escapeHtml(button.href)}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(button.label)}</a></p>
  <p style="font-size:12px;color:#64748b">If the button does not work, copy this link into your browser:<br>${escapeHtml(button.href)}</p>` : ''}
</div>`;

/** Creates a reset link for a user and emails it (unless the hourly limit is reached). */
const issueLink = async (user: { id: string; name: string; email: string }, opts: { ip?: string | null; requestedBy?: { id: string; name: string } }) => {
    const recent = await query(`SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [user.id]);
    if (recent.rows[0].n >= MAX_PER_HOUR) {
        logger.warn({ userId: user.id }, 'Password reset limit reached; no email sent');
        return false;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    await withTransaction(async (db) => {
        // Only the newest link works
        await db.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
        await db.query(
            `INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip, requested_by)
             VALUES ($1, $2, now() + make_interval(mins => $3), $4, $5)`,
            [user.id, sha256(token), LINK_MINUTES, opts.ip ?? null, opts.requestedBy?.id ?? null]
        );
    });
    const link = `${publicAppUrl()}/reset-password?token=${token}`;
    const introText = opts.requestedBy
        ? `${opts.requestedBy.name}, an admin of your company, sent you a link to set a new CloudLedger password.`
        : 'We received a request to reset the password for your CloudLedger account.';
    const intro = escapeHtml(introText);
    const text =
        `Hello ${user.name},\n\n${introText}\n\nSet a new password: ${link}\n\n` +
        `The link works once and expires in ${LINK_MINUTES} minutes. If you did not ask for this, ignore this email; your password stays the same.`;
    await sendMail({
        to: user.email,
        subject: 'Reset your CloudLedger password',
        text,
        html: emailHtml(
            [
                `Hello ${escapeHtml(user.name)},`,
                intro,
                `The link works once and expires in ${LINK_MINUTES} minutes. If you did not ask for this, you can ignore this email; your password stays the same.`,
            ],
            { href: link, label: 'Set a new password' }
        ),
    });
    return true;
};

/**
 * "Forgot password" from the login page. Always resolves the same way, whether or
 * not the email has an account; the email itself is sent in the background so the
 * response time does not give that away either.
 */
export const requestPasswordReset = async (emailRaw: string, ip?: string | null) => {
    const email = String(emailRaw || '').trim().toLowerCase();
    const user = (await query('SELECT id, name, email FROM users WHERE lower(email) = $1', [email])).rows[0];
    if (!user) return;
    issueLink(user, { ip }).catch((err) => logger.error({ err, userId: user.id }, 'Could not send password reset email'));
};

/** A company admin sends a reset link to one of the company's members. */
export const sendResetToMember = async (companyId: string, memberId: string, admin: { id: string }) => {
    if (memberId === admin.id) throw new AppError('Use "Change password" in your profile to change your own password', 400);
    const member = (
        await query(
            `SELECT u.id, u.name, u.email FROM users u JOIN company_users cu ON cu.user_id = u.id
             WHERE cu.company_id = $1 AND u.id = $2`,
            [companyId, memberId]
        )
    ).rows[0];
    if (!member) throw new AppError('Member not found', 404);
    const adminName = (await query('SELECT name FROM users WHERE id = $1', [admin.id])).rows[0]?.name || 'An admin';
    const sent = await issueLink(member, { requestedBy: { id: admin.id, name: adminName } });
    if (!sent) throw new AppError('Several reset links were sent in the last hour. Please wait before sending another.', 429);
    return { email: member.email };
};

const findValidLink = async (token: string) => {
    if (!token || token.length > 100) return null;
    const r = await query(
        `SELECT pr.id, pr.user_id, u.email, u.name FROM password_resets pr JOIN users u ON u.id = pr.user_id
         WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now()`,
        [sha256(token)]
    );
    return r.rows[0] ?? null;
};

/** For the reset page: is the link still usable? (Shows the account's email, masked.) */
export const checkResetLink = async (token: string) => {
    const link = await findValidLink(token);
    if (!link) return { valid: false as const };
    const [local, domain] = String(link.email).split('@');
    return { valid: true as const, email: `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}` };
};

/** Sets the new password, uses up the link, and signs the account out everywhere. */
export const resetPassword = async (token: string, newPassword: string) => {
    const hashed = await hashPassword(newPassword);
    const user = await withTransaction(async (db) => {
        // Lock the link row so the same link cannot be used twice at the same moment
        const r = await db.query(
            `SELECT pr.id, pr.user_id, u.email, u.name FROM password_resets pr JOIN users u ON u.id = pr.user_id
             WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now() FOR UPDATE OF pr`,
            [sha256(token || '')]
        );
        const link = r.rows[0];
        if (!link) throw new AppError('This reset link has expired or was already used. Please request a new one.', 400);
        await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, link.user_id]);
        await db.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [link.user_id]);
        return { id: link.user_id as string, email: link.email as string, name: link.name as string };
    });
    await revokeUserSessions(user.id, null, 'password reset');
    sendMail({
        to: user.email,
        subject: 'Your CloudLedger password was changed',
        text: `Hello ${user.name},\n\nThe password for your CloudLedger account was just changed and you were signed out on all devices.\n\nIf this was not you, reset your password again right away and tell your company admin.`,
        html: emailHtml([
            `Hello ${escapeHtml(user.name)},`,
            'The password for your CloudLedger account was just changed, and you were signed out on all devices.',
            '<b>If this was not you</b>, reset your password again right away and tell your company admin.',
        ]),
    }).catch((err) => logger.error({ err, userId: user.id }, 'Could not send password-changed notice'));
};
