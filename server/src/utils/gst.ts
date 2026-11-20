/** GST state codes (as used in GSTINs and the "place of supply" field). */
export const STATES: [string, string][] = [
    ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'],
    ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'],
    ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
    ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
    ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'],
    ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
    ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
    ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
    ['97', 'Other Territory'], ['96', 'Foreign Country'],
];

const ALIASES: Record<string, string> = {
    orissa: '21', pondicherry: '34', jk: '01', 'jammu & kashmir': '01', 'andaman & nicobar': '35',
    'daman and diu': '26', 'dadra and nagar haveli': '26', 'new delhi': '07', 'nct of delhi': '07',
    up: '09', mp: '23', tn: '33', ap: '37', ts: '36', wb: '19', mh: '27', ka: '29', gj: '24', rj: '08', hr: '06', pb: '03',
};

const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

/** "27", "27-Maharashtra", "Maharashtra", "maharashtra " -> "27". Null if unknown. */
export const stateCode = (value?: string | null): string | null => {
    if (!value) return null;
    const v = String(value).trim();
    const lead = /^(\d{2})\b/.exec(v);
    if (lead && STATES.some(([c]) => c === lead[1])) return lead[1];
    const n = norm(v.replace(/^\d{1,2}\s*[-–]\s*/, ''));
    const hit = STATES.find(([, name]) => norm(name) === n);
    if (hit) return hit[0];
    const alias = Object.entries(ALIASES).find(([k]) => norm(k) === n);
    return alias ? alias[1] : null;
};

export const stateName = (code?: string | null) => STATES.find(([c]) => c === code)?.[1] ?? null;

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Computes the 15th (check) character of a GSTIN from its first 14. */
export const gstinCheckChar = (first14: string): string => {
    let sum = 0;
    for (let i = 0; i < 14; i++) {
        const v = CHARS.indexOf(first14[i]);
        if (v < 0) return '?';
        const p = v * (i % 2 === 0 ? 1 : 2);
        sum += Math.floor(p / 36) + (p % 36);
    }
    return CHARS[(36 - (sum % 36)) % 36];
};

export type GstinCheck = { valid: true; stateCode: string; pan: string } | { valid: false; reason: string };

/** Full GSTIN validation: format, state code and checksum. */
export const validateGstin = (gstin?: string | null): GstinCheck => {
    const g = String(gstin || '').trim().toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { valid: false, reason: 'GSTIN format is invalid' };
    if (!STATES.some(([c]) => c === g.slice(0, 2))) return { valid: false, reason: `Unknown state code ${g.slice(0, 2)} in GSTIN` };
    if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { valid: false, reason: 'GSTIN check digit does not match (typing mistake?)' };
    return { valid: true, stateCode: g.slice(0, 2), pan: g.slice(2, 12) };
};

/** Map common unit symbols to GST Unit Quantity Codes. */
export const UQC_BY_SYMBOL: Record<string, string> = {
    nos: 'NOS', no: 'NOS', pcs: 'PCS', pc: 'PCS', piece: 'PCS', kg: 'KGS', kgs: 'KGS', g: 'GMS', gm: 'GMS', gms: 'GMS',
    l: 'LTR', ltr: 'LTR', litre: 'LTR', ml: 'MLT', m: 'MTR', mtr: 'MTR', meter: 'MTR', cm: 'CMS', mm: 'MMS',
    box: 'BOX', bag: 'BAG', bags: 'BAG', bdl: 'BDL', bundle: 'BDL', btl: 'BTL', bottle: 'BTL', set: 'SET', sets: 'SET',
    pair: 'PRS', prs: 'PRS', dozen: 'DOZ', doz: 'DOZ', ton: 'TON', tonne: 'TON', mt: 'MTS', sqm: 'SQM', sqft: 'SQF',
    sqf: 'SQF', roll: 'ROL', rol: 'ROL', unit: 'UNT', units: 'UNT', hrs: 'OTH', hr: 'OTH', hour: 'OTH', day: 'OTH',
};

export const uqcFor = (uqc?: string | null, symbol?: string | null) =>
    (uqc && uqc.trim().toUpperCase()) || UQC_BY_SYMBOL[String(symbol || '').trim().toLowerCase()] || 'OTH';

/** Income-tax TDS sections commonly deducted by businesses, with default rates (company/firm payee). */
export const TDS_SECTIONS: { code: string; label: string; rate: number }[] = [
    { code: '194C', label: '194C – Contractors (1% individual/HUF, 2% others)', rate: 2 },
    { code: '194J', label: '194J – Professional fees (10%) / technical services (2%)', rate: 10 },
    { code: '194H', label: '194H – Commission or brokerage', rate: 2 },
    { code: '194I', label: '194-I – Rent: land/building (10%), plant & machinery (2%)', rate: 10 },
    { code: '194Q', label: '194Q – Purchase of goods', rate: 0.1 },
    { code: '194O', label: '194-O – E-commerce operator', rate: 0.1 },
    { code: '194A', label: '194A – Interest other than securities', rate: 10 },
];

export type SupplyType = 'NORMAL' | 'SEZ_WPAY' | 'SEZ_WOPAY' | 'EXPORT_WPAY' | 'EXPORT_WOPAY' | 'DEEMED_EXPORT';
export const SUPPLY_TYPES: SupplyType[] = ['NORMAL', 'SEZ_WPAY', 'SEZ_WOPAY', 'EXPORT_WPAY', 'EXPORT_WOPAY', 'DEEMED_EXPORT'];
/** Zero-rated supplies without payment of tax (under LUT/bond). */
export const isWithoutPayment = (t: string) => t === 'SEZ_WOPAY' || t === 'EXPORT_WOPAY';
/** Exports and SEZ supplies are always inter-state (IGST). */
export const isAlwaysInterState = (t: string) => t !== 'NORMAL' && t !== 'DEEMED_EXPORT';
