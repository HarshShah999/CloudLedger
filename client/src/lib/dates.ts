/** Today as YYYY-MM-DD in the user's local time zone. */
export const today = (): string => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Current Indian financial year (1 April – 31 March). */
export const currentFinancialYear = (date: string = today()) => {
    const [y, m] = date.split('-').map(Number);
    const start = m >= 4 ? y : y - 1;
    return { startDate: `${start}-04-01`, endDate: `${start + 1}-03-31`, name: `${start}-${String((start + 1) % 100).padStart(2, '0')}` };
};

/** Formats YYYY-MM-DD (or ISO) as DD-MM-YYYY, the format Indian users expect. */
export const formatDate = (value?: string | null): string => {
    if (!value) return '';
    const [y, m, d] = String(value).slice(0, 10).split('-');
    return d && m && y ? `${d}-${m}-${y}` : String(value);
};
