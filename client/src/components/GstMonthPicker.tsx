import React from 'react';

/** Previous month by default: returns are filed for the month gone by. */
export const defaultReturnMonth = () => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** "2025-06" -> { from: '2025-06-01', to: '2025-06-30', period: '062025' } */
export const monthRange = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, period: `${String(m).padStart(2, '0')}${y}` };
};

export const GstMonthPicker: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
    <label className="flex items-center gap-2 text-sm text-slate-600">
        Return month
        <input type="month" className="input-field w-auto py-1" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
);
