import { describe, expect, it } from 'vitest';
import { normaliseEntries } from '../../src/services/posting';
import { addPeriod } from '../../src/services/recurringService';
import { indianFinancialYear } from '../../src/services/financialYear';

const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';

describe('normaliseEntries', () => {
    it('accepts a balanced voucher', () => {
        const r = normaliseEntries([
            { ledgerId: L1, amount: 100.1, type: 'Dr' },
            { ledgerId: L2, amount: '100.10', type: 'Cr' },
        ]);
        expect(r.totalPaise).toBe(10010);
    });

    it('rejects an unbalanced voucher by a single paisa', () => {
        expect(() =>
            normaliseEntries([
                { ledgerId: L1, amount: 100, type: 'Dr' },
                { ledgerId: L2, amount: 99.99, type: 'Cr' },
            ])
        ).toThrow(/not balanced/);
    });

    it('drops zero lines and flips negatives', () => {
        const r = normaliseEntries([
            { ledgerId: L1, amount: 50, type: 'Dr' },
            { ledgerId: L2, amount: -50, type: 'Dr' },
            { ledgerId: L2, amount: 0, type: 'Cr' },
        ]);
        expect(r.entries).toHaveLength(2);
        expect(r.entries[1].type).toBe('Cr');
    });

    it('rejects single-sided vouchers', () => {
        expect(() => normaliseEntries([{ ledgerId: L1, amount: 1, type: 'Dr' }])).toThrow();
    });
});

describe('dates', () => {
    it('adds periods with month-end clamping', () => {
        expect(addPeriod('2025-01-31', 'MONTHLY')).toBe('2025-02-28');
        expect(addPeriod('2024-01-31', 'MONTHLY')).toBe('2024-02-29');
        expect(addPeriod('2025-11-15', 'QUARTERLY')).toBe('2026-02-15');
        expect(addPeriod('2025-12-29', 'WEEKLY')).toBe('2026-01-05');
        expect(addPeriod('2025-03-31', 'YEARLY')).toBe('2026-03-31');
    });

    it('computes the Indian financial year', () => {
        expect(indianFinancialYear('2026-03-31')).toEqual({ name: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31' });
        expect(indianFinancialYear('2026-04-01').name).toBe('2026-27');
    });
});
