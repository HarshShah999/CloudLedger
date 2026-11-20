import { describe, expect, it } from 'vitest';
import { calculateInvoice, isInterStateSupply } from '../../src/services/invoiceCalc';

describe('calculateInvoice', () => {
    it('splits CGST/SGST for intra-state supply', () => {
        const r = calculateInvoice([{ quantity: 2, rate: 500, taxRate: 18 }], { isInterState: false });
        expect(r.subtotal).toBe(1000);
        expect(r.cgst).toBe(90);
        expect(r.sgst).toBe(90);
        expect(r.igst).toBe(0);
        expect(r.grandTotal).toBe(1180);
    });

    it('charges IGST for inter-state supply', () => {
        const r = calculateInvoice([{ quantity: 1, rate: 1000, taxRate: 12 }], { isInterState: true });
        expect(r.igst).toBe(120);
        expect(r.cgst + r.sgst).toBe(0);
        expect(r.lines[0].igst_rate).toBe(12);
    });

    it('applies line then invoice discount BEFORE tax', () => {
        // 1000 - 10% line = 900; invoice 10% = 90 -> taxable 810; GST 18% = 145.80
        const r = calculateInvoice([{ quantity: 1, rate: 1000, taxRate: 18, discountPercent: 10 }], {
            isInterState: false,
            invoiceDiscountPercent: 10,
        });
        expect(r.subtotal).toBe(810);
        expect(r.invoiceDiscount).toBe(90);
        expect(r.lines[0].discount_amount).toBe(190);
        expect(r.taxTotal).toBe(145.8);
        expect(r.grandTotal).toBe(955.8);
    });

    it('rounds the grand total to the rupee and reports round-off', () => {
        const r = calculateInvoice([{ quantity: 3, rate: 33.33, taxRate: 5 }], { isInterState: false, roundOff: true });
        // 99.99 taxable, 2.50 + 2.50 tax = 104.99 -> 105.00
        expect(r.grandTotal).toBe(105);
        expect(r.roundOff).toBe(0.01);
        expect(Math.round((r.subtotal + r.taxTotal + r.roundOff) * 100)).toBe(10500);
    });

    it('keeps totals equal to the sum of lines (no paisa lost)', () => {
        const items = Array.from({ length: 7 }, (_, i) => ({ quantity: 1.5 + i, rate: 19.99 * (i + 1), taxRate: [0, 5, 12, 18, 28][i % 5] }));
        const r = calculateInvoice(items, { isInterState: false, invoiceDiscountPercent: 3.5 });
        const sum = (k: 'taxable_amount' | 'tax_amount' | 'total_amount') =>
            Math.round(r.lines.reduce((s, l) => s + l[k] * 100, 0));
        expect(sum('taxable_amount')).toBe(Math.round(r.subtotal * 100));
        expect(sum('tax_amount')).toBe(Math.round(r.taxTotal * 100));
        expect(sum('total_amount')).toBe(Math.round(r.grandTotal * 100));
    });

    it('validates inputs', () => {
        expect(() => calculateInvoice([{ quantity: 0, rate: 1, taxRate: 0 }], { isInterState: false })).toThrow();
        expect(() => calculateInvoice([{ quantity: 1, rate: -1, taxRate: 0 }], { isInterState: false })).toThrow();
        expect(() => calculateInvoice([{ quantity: 1, rate: 1, taxRate: 0 }], { isInterState: false, invoiceDiscountPercent: 150 })).toThrow();
    });
});

describe('isInterStateSupply', () => {
    it('compares states loosely', () => {
        expect(isInterStateSupply('Maharashtra', '27-Maharashtra')).toBe(false);
        expect(isInterStateSupply('Gujarat', 'Maharashtra')).toBe(true);
        expect(isInterStateSupply('', 'Maharashtra')).toBe(false);
    });
});
