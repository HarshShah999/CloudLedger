/**
 * Indian number and date formats, used on every screen:
 *  amount(158496.5) -> "1,58,496.50"
 *  inr(158496.5)    -> "₹1,58,496.50"
 *  formatDateTime   -> "20-11-2026, 4:05 pm"
 */
const INDIAN = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const amount = (value: number | string | null | undefined): string => {
    const n = Number(value);
    return INDIAN.format(Number.isFinite(n) ? n : 0);
};

export const inr = (value: number | string | null | undefined): string => {
    const n = Number(value);
    const safe = Number.isFinite(n) ? n : 0;
    return (safe < 0 ? '-₹' : '₹') + INDIAN.format(Math.abs(safe));
};

/** Whole rupees, for dashboard tiles: "₹2,43,064" */
export const inrRounded = (value: number | string | null | undefined): string =>
    '₹' + Math.round(Number(value) || 0).toLocaleString('en-IN');

const pad = (n: number) => String(n).padStart(2, '0');

/** Date and time as DD-MM-YYYY, h:mm am/pm in the user's time zone. */
export const formatDateTime = (value?: string | Date | null): string => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const h = d.getHours();
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}, ${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
};
