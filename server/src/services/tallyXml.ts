/** Small helpers for reading Tally XML exports (shared by the master and voucher importers). */

export const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export const text = (v: any): string => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v)).trim();

/** Finds the first value for `key` anywhere inside `node` (Tally nests GST details in many shapes). */
export const deepFind = (node: any, key: string): any => {
    if (!node || typeof node !== 'object') return undefined;
    if (key in node) return node[key];
    for (const v of Object.values(node)) {
        const found = Array.isArray(v) ? v.map((x) => deepFind(x, key)).find((x) => x !== undefined) : deepFind(v, key);
        if (found !== undefined) return found;
    }
    return undefined;
};

/** "-1,250.00" -> -1250 ; "100 Kgs" -> 100 ; "65.00/kg" -> 65 */
export const tallyNumber = (v: any) => {
    const m = /-?[\d,]*\.?\d+/.exec(text(v));
    return m ? Number(m[0].replace(/,/g, '')) : 0;
};

/** "20250415" -> "2025-04-15" */
export const tallyDate = (v: any) => {
    const d = text(v);
    return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
};

export const yes = (v: any) => /^yes$/i.test(text(v));

/** "30 Days" -> 30 ; "15-May-2025" style due dates are ignored */
export const creditDays = (v: any): number | null => {
    const m = /^\s*(\d+)\s*(day|days)?\s*$/i.exec(text(v));
    return m ? Number(m[1]) : null;
};

export const addDays = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

/** Tally's GST duty heads mapped to ours. */
export const taxHeadFromDutyHead = (v: any): string | null => {
    const s = text(v).toLowerCase();
    if (!s) return null;
    if (s.includes('central')) return 'CGST';
    if (s.includes('state') || s.includes('ut tax') || s === 'ut') return 'SGST';
    if (s.includes('integrated')) return 'IGST';
    if (s.includes('cess')) return 'CESS';
    return null;
};

/** Fallback when a tax ledger has no duty head: guess from its name. */
export const taxHeadFromName = (name: string): string | null => {
    if (/\bcess\b/i.test(name)) return 'CESS';
    if (/\bcgst\b|central\s*tax/i.test(name)) return 'CGST';
    if (/\b(sgst|utgst)\b|state\s*tax|\but\s*tax/i.test(name)) return 'SGST';
    if (/\bigst\b|integrated\s*tax/i.test(name)) return 'IGST';
    return null;
};
