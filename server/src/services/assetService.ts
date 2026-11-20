import { query } from '../config/db';
import { AppError } from '../middleware/errorHandler';

export type AssetKind = 'logo' | 'signature';
export const ASSET_KINDS: AssetKind[] = ['logo', 'signature'];
const MAX_BYTES = 500 * 1024;

/** Detects PNG/JPEG from magic bytes (never trust the declared type). */
const sniff = (buf: Buffer): string | null => {
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    return null;
};

/** Saves an image sent as a data URL (data:image/png;base64,...). */
export const saveAsset = async (companyId: string, kind: AssetKind, dataUrl: string, userId?: string) => {
    const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
    if (!m) throw new AppError('Upload a PNG or JPG image', 400);
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_BYTES) throw new AppError('Image is too large (max 500 KB)', 400);
    const mime = sniff(buf);
    if (!mime) throw new AppError('The file is not a valid PNG or JPG image', 400);
    await query(
        `INSERT INTO company_assets (company_id, kind, mime, data, updated_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, kind) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data,
             updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        [companyId, kind, mime, buf, userId ?? null]
    );
};

export const deleteAsset = (companyId: string, kind: AssetKind) =>
    query('DELETE FROM company_assets WHERE company_id = $1 AND kind = $2', [companyId, kind]);

export const getAsset = async (companyId: string, kind: AssetKind): Promise<{ mime: string; data: Buffer } | null> => {
    const r = await query('SELECT mime, data FROM company_assets WHERE company_id = $1 AND kind = $2', [companyId, kind]);
    return r.rows[0] ?? null;
};

export const listAssetKinds = async (companyId: string): Promise<AssetKind[]> =>
    (await query('SELECT kind FROM company_assets WHERE company_id = $1', [companyId])).rows.map((r) => r.kind);
