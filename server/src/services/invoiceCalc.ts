import { fromPaise, percentOf, toPaise } from '../utils/money';

export interface CalcLineInput {
    quantity: number | string;
    rate: number | string;
    taxRate: number | string;
    discountPercent?: number | string;
}

export interface CalcLine {
    quantity: number;
    rate: number;
    amount: number; // qty × rate
    discount_percent: number; // line discount %
    discount_amount: number; // line discount + share of invoice discount
    taxable_amount: number;
    tax_rate: number;
    cgst_rate: number;
    cgst_amount: number;
    sgst_rate: number;
    sgst_amount: number;
    igst_rate: number;
    igst_amount: number;
    tax_amount: number;
    total_amount: number;
}

export interface CalcResult {
    lines: CalcLine[];
    gross: number; // Σ qty × rate
    lineDiscount: number; // Σ line discounts
    invoiceDiscount: number; // invoice-level discount amount
    subtotal: number; // Σ taxable value (after all discounts)
    cgst: number;
    sgst: number;
    igst: number;
    taxTotal: number;
    roundOff: number;
    grandTotal: number;
}

/**
 * GST invoice maths, all in integer paise.
 *
 * - Line discount applies first, then the invoice-level discount is spread over
 *   lines in proportion to their value, BEFORE tax. GST is charged on the
 *   discounted (taxable) value, as the GST law requires for discounts shown on
 *   the invoice.
 * - Intra-state: CGST = SGST = rate/2. Inter-state: IGST = rate.
 * - Zero-rated supplies without payment (exports/SEZ under LUT) carry no tax.
 * - Optional rounding of the grand total to the nearest rupee.
 */
export const calculateInvoice = (
    items: CalcLineInput[],
    opts: { invoiceDiscountPercent?: number | string; isInterState: boolean; roundOff?: boolean; withoutPayment?: boolean }
): CalcResult => {
    const invPct = Number(opts.invoiceDiscountPercent || 0);
    if (invPct < 0 || invPct > 100) throw new Error('Invoice discount must be between 0 and 100%');

    let gross = 0;
    let lineDisc = 0;
    let invDisc = 0;
    let subtotal = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    const lines: CalcLine[] = items.map((it) => {
        const qty = Number(it.quantity);
        const rate = Number(it.rate);
        const taxRate = Number(it.taxRate || 0);
        const discPct = Number(it.discountPercent || 0);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be greater than zero');
        if (!Number.isFinite(rate) || rate < 0) throw new Error('Rate cannot be negative');
        if (taxRate < 0 || taxRate > 100) throw new Error('Invalid tax rate');
        if (discPct < 0 || discPct > 100) throw new Error('Line discount must be between 0 and 100%');

        const amountP = Math.round(qty * toPaise(rate));
        const lineDiscP = percentOf(amountP, discPct);
        const afterLineP = amountP - lineDiscP;
        const invDiscP = percentOf(afterLineP, invPct);
        const taxableP = afterLineP - invDiscP;

        let c = 0;
        let s = 0;
        let i = 0;
        if (opts.withoutPayment) {
            // Zero-rated supply under LUT/bond: rate is shown, no tax is charged
        } else if (opts.isInterState) {
            i = percentOf(taxableP, taxRate);
        } else {
            c = percentOf(taxableP, taxRate / 2);
            s = percentOf(taxableP, taxRate / 2);
        }

        gross += amountP;
        lineDisc += lineDiscP;
        invDisc += invDiscP;
        subtotal += taxableP;
        cgst += c;
        sgst += s;
        igst += i;

        return {
            quantity: qty,
            rate,
            amount: fromPaise(amountP),
            discount_percent: discPct,
            discount_amount: fromPaise(lineDiscP + invDiscP),
            taxable_amount: fromPaise(taxableP),
            tax_rate: taxRate,
            cgst_rate: opts.isInterState ? 0 : taxRate / 2,
            cgst_amount: fromPaise(c),
            sgst_rate: opts.isInterState ? 0 : taxRate / 2,
            sgst_amount: fromPaise(s),
            igst_rate: opts.isInterState ? taxRate : 0,
            igst_amount: fromPaise(i),
            tax_amount: fromPaise(c + s + i),
            total_amount: fromPaise(taxableP + c + s + i),
        };
    });

    const taxTotal = cgst + sgst + igst;
    const beforeRound = subtotal + taxTotal;
    const rounded = opts.roundOff ? Math.round(beforeRound / 100) * 100 : beforeRound;
    const roundOff = rounded - beforeRound;

    return {
        lines,
        gross: fromPaise(gross),
        lineDiscount: fromPaise(lineDisc),
        invoiceDiscount: fromPaise(invDisc),
        subtotal: fromPaise(subtotal),
        cgst: fromPaise(cgst),
        sgst: fromPaise(sgst),
        igst: fromPaise(igst),
        taxTotal: fromPaise(taxTotal),
        roundOff: fromPaise(roundOff),
        grandTotal: fromPaise(rounded),
    };
};

/** Normalises an Indian state name or "27-Maharashtra" style value for comparison. */
export const normaliseState = (s?: string | null) =>
    (s || '')
        .toLowerCase()
        .replace(/^\d{1,2}\s*[-–]\s*/, '')
        .replace(/[^a-z]/g, '');

/**
 * Supply is inter-state when the supplier's state differs from the place of
 * supply. Unknown states are treated as intra-state (previous behaviour).
 */
export const isInterStateSupply = (companyState?: string | null, placeOfSupply?: string | null) => {
    const a = normaliseState(companyState);
    const b = normaliseState(placeOfSupply);
    return !!a && !!b && a !== b;
};
