import React from 'react';

export interface AuditEntry {
    id: number;
    txid: string;
    table: string;
    entity: string;
    label: string;
    recordId: string;
    action: 'INSERT' | 'UPDATE' | 'DELETE';
    changedFields: string[] | null;
    oldData: Record<string, any> | null;
    newData: Record<string, any> | null;
    user: string;
    ip: string | null;
    at: string;
}

const HIDDEN = new Set(['id', 'company_id', 'created_at', 'updated_at', 'voucher_id', 'invoice_id', 'financial_year_id']);

export const prettyField = (f: string) =>
    f.replace(/_id$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const show = (v: any) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
};

export const ACTION_STYLE: Record<string, string> = {
    INSERT: 'bg-green-100 text-green-700',
    UPDATE: 'bg-amber-100 text-amber-700',
    DELETE: 'bg-red-100 text-red-700',
};
export const ACTION_LABEL: Record<string, string> = { INSERT: 'Created', UPDATE: 'Changed', DELETE: 'Deleted' };

/** Field-level before → after for one audit entry. */
export const AuditChanges: React.FC<{ entry: AuditEntry }> = ({ entry }) => {
    if (entry.action === 'UPDATE') {
        const fields = (entry.changedFields || []).filter((f) => !HIDDEN.has(f));
        if (!fields.length) return <span className="text-slate-400">No visible changes</span>;
        return (
            <ul className="space-y-0.5">
                {fields.map((f) => (
                    <li key={f}>
                        <span className="text-slate-500">{prettyField(f)}:</span>{' '}
                        <span className="text-red-600 line-through">{show(entry.oldData?.[f])}</span>{' '}
                        → <span className="text-green-700">{show(entry.newData?.[f])}</span>
                    </li>
                ))}
            </ul>
        );
    }
    const data = entry.action === 'INSERT' ? entry.newData : entry.oldData;
    const keys = Object.keys(data || {}).filter((k) => !HIDDEN.has(k) && data![k] !== null && data![k] !== '').slice(0, 8);
    return (
        <span className="text-slate-600">
            {keys.map((k) => `${prettyField(k)}: ${show(data![k])}`).join(' · ')}
        </span>
    );
};
