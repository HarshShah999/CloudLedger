import crypto from 'crypto';

/**
 * Encrypts small secrets (e.g. a WhatsApp API token) for storage in the database
 * with AES-256-GCM. The key comes from SECRETS_KEY, falling back to JWT_SECRET.
 */
const key = () =>
    crypto.createHash('sha256').update(process.env.SECRETS_KEY || process.env.JWT_SECRET || '').digest();

export const encryptSecret = (plain: string): string => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
};

export const decryptSecret = (stored: string | null | undefined): string | null => {
    if (!stored) return null;
    const [v, iv, tag, ct] = stored.split(':');
    if (v !== 'v1') return null;
    try {
        const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
        d.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
    } catch {
        return null; // key changed or data tampered with
    }
};
