import React, { useEffect, useState } from 'react';
import { ShieldCheck, Filter, Loader2 } from 'lucide-react';
import api, { apiError } from '../api/axios';
import { useCompany } from '../context/CompanyContext';
import { notify } from '../utils/notification';
import { Button } from '../components/ui/Button';
import { AuditChanges, AuditEntry, ACTION_LABEL, ACTION_STYLE } from '../components/AuditChanges';
import { formatDateTime } from '../lib/format';

const ENTITIES = [
    ['', 'All documents & masters'],
    ['invoices', 'Invoices / notes'],
    ['vouchers', 'Vouchers'],
    ['payments', 'Payments'],
    ['ledgers', 'Ledgers'],
    ['items', 'Items'],
    ['financial_years', 'Financial years'],
    ['company_users', 'User access'],
    ['companies', 'Company settings'],
    ['voucher_entries', 'Voucher entries (detail)'],
    ['invoice_items', 'Invoice lines (detail)'],
];

/** Read-only edit log of every change in the company (Companies Act audit trail). */
export const AuditTrail: React.FC = () => {
    const { selectedCompany } = useCompany();
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [cursor, setCursor] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState({ table: '', action: '', from: '', to: '' });

    const load = async (append = false) => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const params: Record<string, string | number> = { companyId: selectedCompany.id, limit: 50 };
            Object.entries(filters).forEach(([k, v]) => v && (params[k] = v));
            if (append && cursor) params.before = cursor;
            const res = await api.get('/audit', { params });
            setEntries((prev) => (append ? [...prev, ...res.data.data.entries] : res.data.data.entries));
            setCursor(res.data.data.nextCursor);
        } catch (err) {
            notify.error(apiError(err, 'Could not load the audit trail'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCompany?.id]);

    return (
        <div className="space-y-6">
            <div className="flex items-start gap-3">
                <ShieldCheck className="mt-1 h-7 w-7 text-primary" />
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Audit Trail</h1>
                    <p className="text-sm text-slate-500">
                        Every creation, change and deletion with who made it and when. This log is permanent: it cannot be edited,
                        deleted or switched off (Companies (Accounts) Rules, Rule 3(1)).
                    </p>
                </div>
            </div>

            <form
                className="card grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-end"
                onSubmit={(e) => {
                    e.preventDefault();
                    load();
                }}
            >
                <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                    Show
                    <select className="input-field mt-1" value={filters.table} onChange={(e) => setFilters({ ...filters, table: e.target.value })}>
                        {ENTITIES.map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                        ))}
                    </select>
                </label>
                <label className="text-sm font-medium text-slate-700">
                    Action
                    <select className="input-field mt-1" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
                        <option value="">Any</option>
                        <option value="INSERT">Created</option>
                        <option value="UPDATE">Changed</option>
                        <option value="DELETE">Deleted</option>
                    </select>
                </label>
                <label className="text-sm font-medium text-slate-700">
                    From
                    <input type="date" className="input-field mt-1" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
                </label>
                <label className="text-sm font-medium text-slate-700">
                    To
                    <input type="date" className="input-field mt-1" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
                </label>
                <div className="sm:col-span-5 flex justify-end">
                    <Button type="submit" isLoading={loading}>
                        <Filter className="h-4 w-4" /> Apply
                    </Button>
                </div>
            </form>

            <div className="card overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-slate-600">
                            <th className="px-3 py-2">When</th>
                            <th className="px-3 py-2">User</th>
                            <th className="px-3 py-2">Action</th>
                            <th className="px-3 py-2">Record</th>
                            <th className="px-3 py-2">Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.length === 0 && !loading && (
                            <tr>
                                <td colSpan={5} className="py-8 text-center text-slate-500">No changes found</td>
                            </tr>
                        )}
                        {entries.map((e) => (
                            <tr key={e.id} className="border-b border-slate-100 align-top">
                                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                                    {formatDateTime(e.at)}
                                </td>
                                <td className="px-3 py-2">{e.user}</td>
                                <td className="px-3 py-2">
                                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${ACTION_STYLE[e.action]}`}>{ACTION_LABEL[e.action]}</span>
                                </td>
                                <td className="px-3 py-2">
                                    <span className="text-slate-500">{e.entity}</span>
                                    {e.label && <span className="block font-medium text-slate-800">{e.label}</span>}
                                </td>
                                <td className="px-3 py-2 text-xs">
                                    <AuditChanges entry={e} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {loading && (
                    <div className="flex justify-center py-4 text-slate-500">
                        <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                )}
                {cursor && !loading && (
                    <div className="flex justify-center py-4">
                        <Button variant="secondary" onClick={() => load(true)}>Load older changes</Button>
                    </div>
                )}
            </div>
        </div>
    );
};
