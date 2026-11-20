import { describe, expect, it } from 'vitest';
import { whatsappNumber, whatsappUrl, upiLink } from '../../src/services/documentService';
import { amountInWords } from '../../src/utils/words';

describe('whatsapp helpers', () => {
    it('normalises Indian mobile numbers', () => {
        expect(whatsappNumber('98765 43210')).toBe('919876543210');
        expect(whatsappNumber('+91-98765-43210')).toBe('919876543210');
        expect(whatsappNumber('09876543210')).toBe('919876543210');
        expect(whatsappNumber('12345')).toBeNull();
        expect(whatsappNumber(null)).toBeNull();
    });

    it('builds a wa.me link with the message encoded', () => {
        expect(whatsappUrl('9876543210', 'Hi & bye')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye');
        expect(whatsappUrl(null, 'x')).toBe('https://wa.me/?text=x');
    });
});

describe('upiLink', () => {
    it('creates a UPI intent with amount', () => {
        const link = upiLink({ upi_id: 'shop@okhdfcbank', name: 'My Shop' }, 1180, 'Invoice INV/25-26/0001')!;
        expect(link.startsWith('upi://pay?')).toBe(true);
        const p = new URLSearchParams(link.split('?')[1]);
        expect(p.get('pa')).toBe('shop@okhdfcbank');
        expect(p.get('am')).toBe('1180.00');
        expect(p.get('cu')).toBe('INR');
    });
    it('returns null without a UPI id or amount', () => {
        expect(upiLink({ upi_id: null, name: 'x' }, 10, 'n')).toBeNull();
        expect(upiLink({ upi_id: 'a@b', name: 'x' }, 0, 'n')).toBeNull();
    });
});

describe('amountInWords', () => {
    it('uses lakh and crore', () => {
        expect(amountInWords(0)).toBe('Indian Rupees Zero Only');
        expect(amountInWords(118)).toBe('Indian Rupees One Hundred Eighteen Only');
        expect(amountInWords(100000)).toBe('Indian Rupees One Lakh Only');
        expect(amountInWords(12345678.9)).toBe(
            'Indian Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Paise Only'
        );
    });
});
