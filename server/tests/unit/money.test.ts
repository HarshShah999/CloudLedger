import { describe, expect, it } from 'vitest';
import { toPaise, fromPaise, round2, percentOf, formatINR } from '../../src/utils/money';

describe('money', () => {
    it('converts to paise without float drift', () => {
        expect(toPaise(0.1) + toPaise(0.2)).toBe(toPaise(0.3));
        expect(toPaise('1234.56')).toBe(123456);
        expect(toPaise(1.005)).toBe(101);
        expect(toPaise(-2.5)).toBe(-250);
    });

    it('rejects non-numbers', () => {
        expect(() => toPaise('abc')).toThrow();
    });

    it('rounds and formats', () => {
        expect(round2(10.555)).toBe(10.56);
        expect(fromPaise(percentOf(10000, 18))).toBe(18);
        expect(formatINR(123456.5)).toBe('₹1,23,456.50');
    });
});
