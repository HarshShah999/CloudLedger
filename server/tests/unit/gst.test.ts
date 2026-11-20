import { describe, expect, it } from 'vitest';
import { validateGstin, gstinCheckChar, stateCode, uqcFor } from '../../src/utils/gst';
import { calculateInvoice } from '../../src/services/invoiceCalc';
import { parseGstr2b, normaliseDocNo } from '../../src/services/gstr2bService';

describe('GSTIN', () => {
    it('validates a real GSTIN and rejects a typo', () => {
        expect(validateGstin('27AAACT2727Q1ZW')).toEqual({ valid: true, stateCode: '27', pan: 'AAACT2727Q' });
        const typo = validateGstin('27AAACT2727Q1ZX');
        expect(typo.valid).toBe(false);
        expect(validateGstin('99AAACT2727Q1ZW').valid).toBe(false);
        expect(validateGstin('hello').valid).toBe(false);
    });
    it('computes check characters', () => {
        expect(gstinCheckChar('27AAACT2727Q1Z')).toBe('W');
    });
});

describe('states and units', () => {
    it('maps names and codes', () => {
        expect(stateCode('Maharashtra')).toBe('27');
        expect(stateCode('27-Maharashtra')).toBe('27');
        expect(stateCode('Orissa')).toBe('21');
        expect(stateCode('Foreign Country')).toBe('96');
        expect(stateCode('Atlantis')).toBeNull();
    });
    it('maps unit symbols to UQC', () => {
        expect(uqcFor(null, 'kg')).toBe('KGS');
        expect(uqcFor('BOX', 'kg')).toBe('BOX');
        expect(uqcFor(null, 'widgets')).toBe('OTH');
    });
});

describe('zero-rated supply', () => {
    it('keeps the rate but charges no tax under LUT', () => {
        const r = calculateInvoice([{ quantity: 1, rate: 1000, taxRate: 18 }], { isInterState: true, withoutPayment: true });
        expect(r.taxTotal).toBe(0);
        expect(r.lines[0].igst_rate).toBe(18);
        expect(r.grandTotal).toBe(1000);
    });
});

describe('GSTR-2B parsing', () => {
    it('reads the portal JSON layout', () => {
        const parsed = parseGstr2b({
            data: {
                gstin: '27ABCDE1234F1Z0',
                rtnprd: '062025',
                docdata: {
                    b2b: [{ ctin: '27aaacs1234k1zh', trdnm: 'Steel Co', inv: [{ inum: 'SC/001', dt: '05-06-2025', val: 1180, rev: 'N', itcavl: 'Y', items: [{ rt: 18, txval: 1000, cgst: 90, sgst: 90, igst: 0 }] }] }],
                    cdnr: [{ ctin: '27AAACS1234K1ZH', nt: [{ ntnum: 'CN-1', typ: 'C', dt: '20-06-2025', val: 118, items: [{ txval: 100, cgst: 9, sgst: 9 }] }] }],
                },
            },
        });
        expect(parsed.period).toBe('062025');
        expect(parsed.documents).toHaveLength(2);
        expect(parsed.documents[0]).toMatchObject({ kind: 'INVOICE', ctin: '27AAACS1234K1ZH', date: '2025-06-05', taxable: 1000, cgst: 90 });
        expect(parsed.documents[1].kind).toBe('CREDIT_NOTE');
    });
    it('rejects files that are not GSTR-2B', () => {
        expect(() => parseGstr2b('{"foo":1}')).toThrow();
        expect(() => parseGstr2b('not json')).toThrow();
    });
    it('normalises supplier invoice numbers', () => {
        expect(normaliseDocNo('SC/001')).toBe(normaliseDocNo('sc-1'));
        expect(normaliseDocNo('INV 25/26-0042')).toBe('INV252642');
        expect(normaliseDocNo('SS-0077')).toBe(normaliseDocNo('ss/77'));
    });
});
