import React, { useState } from 'react';
import { History, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import api from '../api/axios';
import { useCompany } from '../context/CompanyContext';
import { AuditChanges, AuditEntry, ACTION_LABEL, ACTION_STYLE } from './AuditChanges';

interface Group {
    txid: string;
    at: string;
    user: string;
    changes: AuditEntry[];
}

/** Collapsible "who changed this and when" panel for one document. */
export const DocumentHistory: React.FC<{ recordId: string }> = ({ recordId }) => {
    const { selectedCompany } = useCompany();
    const [open, setOpen] = useState(false);
    const [history, setHistory] = useState<Group[] | null>(null);
    const [loading, setLoading] = useState(false);

    const toggle = async () => {
        const next = !open;
        setOpen(next);
        if (next && selectedCompany) {
            setLoading(true);
            try {
                const res = await api.get(`/audit/record/${recordId}`, { params: { companyId: selectedCompany.id } });
                setHistory(res.data.data.history);
            } finally {
                setLoading(false);
            }
        }
    };

    return (
        <div className="card">
            <button type="button" onClick={toggle} className="flex w-full items-center justify-between text-left">
                <span className="flex items-center gap-2 font-semibold text-slate-700">
                    <History className="h-5 w-5" /> History
                </span>
                {open ? <ChevronUp className="h-5 w-5 text-slate-400" /> : <ChevronDown className="h-5 w-5 text-slate-400" />}
            </button>
            {open && (
                <div className="mt-4 space-y-4">
                    {loading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
                    {history?.length === 0 && <p className="text-sm text-slate-500">No recorded changes.</p>}
                    {history?.map((g) => {
                        const main = g.changes.find((c) => c.recordId === recordId) || g.changes[0];
                        return (
                            <div key={g.txid} className="border-l-2 border-slate-200 pl-4">
                                <p className="text-sm">
                                    <span className={`mr-2 rounded px-2 py-0.5 text-xs font-medium ${ACTION_STYLE[main.action]}`}>
                                        {ACTION_LABEL[main.action]}
                                    </span>
                                    <span className="font-medium text-slate-800">{g.user}</span>
                                    <span className="text-slate-500"> · {new Date(g.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                                </p>
                                {main.action === 'UPDATE' && (
                                    <div className="mt-1 text-xs">
                                        <AuditChanges entry={main} />
                                    </div>
                                )}
                                <p className="mt-1 text-xs text-slate-400">
                                    {g.changes.length} record{g.changes.length === 1 ? '' : 's'} affected (lines, ledger entries)
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
