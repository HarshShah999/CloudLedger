/**
 * Money helpers. All accounting arithmetic is done in integer paise to avoid
 * floating-point drift (0.1 + 0.2 !== 0.3). Convert at the edges only.
 */

export const toPaise = (value: number | string | null | undefined): number => {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${value}`);
    // Add a tiny epsilon in the direction of the sign so 1.005 -> 101 paise
    return Math.round(n * 100 + (n >= 0 ? 1e-7 : -1e-7));
};

export const fromPaise = (paise: number): number => paise / 100;

/** Round a rupee amount to 2 decimals (half away from zero). */
export const round2 = (value: number): number => fromPaise(toPaise(value));

/** Percentage of a paise amount, rounded to the nearest paisa. */
export const percentOf = (paise: number, percent: number): number =>
    Math.round((paise * Number(percent || 0)) / 100 + (paise >= 0 ? 1e-7 : -1e-7));

/** Format as Indian currency, e.g. 123456.5 -> "₹1,23,456.50". */
export const formatINR = (value: number): string =>
    '₹' + Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
