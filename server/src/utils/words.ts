const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const belowThousand = (n: number): string => {
    const parts: string[] = [];
    if (n >= 100) {
        parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
        n %= 100;
    }
    if (n >= 20) {
        parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
    } else if (n > 0) {
        parts.push(ONES[n]);
    }
    return parts.join(' ');
};

/** Indian numbering: crore, lakh, thousand. */
const integerToWords = (n: number): string => {
    if (n === 0) return 'Zero';
    const parts: string[] = [];
    const crore = Math.floor(n / 1e7);
    n %= 1e7;
    const lakh = Math.floor(n / 1e5);
    n %= 1e5;
    const thousand = Math.floor(n / 1e3);
    n %= 1e3;
    if (crore) parts.push(`${integerToWords(crore)} Crore`);
    if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
    if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
    if (n) parts.push(belowThousand(n));
    return parts.join(' ');
};

/** 1234.5 -> "Indian Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only" */
export const amountInWords = (amount: number): string => {
    const paiseTotal = Math.round(Math.abs(Number(amount) || 0) * 100);
    const rupees = Math.floor(paiseTotal / 100);
    const paise = paiseTotal % 100;
    let s = `Indian Rupees ${integerToWords(rupees)}`;
    if (paise) s += ` and ${belowThousand(paise)} Paise`;
    return `${s} Only`;
};
