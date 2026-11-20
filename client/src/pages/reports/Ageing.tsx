import React, { Fragment, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, MessageCircle, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api, { apiError } from '../../api/axios';
import { useCompany } from '../../context/CompanyContext';
import { notify } from '../../utils/notification';
import { formatDate, today } from '../../lib/dates';
import { currentFinancialYear } from '../../lib/dates';

type Kind = 'receivable' | 'payable';
const BUCKETS: [string, string][] = [
    ['not_due', 'Not due'],
    ['d1_30', '1–30 days'],
    ['d31_60', '31–60'],
    ['d61_90', '61–90'],
    ['d90_plus', '90+ days'],
];
const inr = (n: number) => (n ? '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—');
const waNumber = (phone?: string | null) => {
    let d = (phone || '').replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) d = `91${d}`;
    return d;
};

/** Outstanding receivables / payables, bill-wise, aged by due date. */
export const Ageing: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [kind, setKind] = useState<Kind>('receivable');
    const [asOf, setAsOf] = useState(today());
    const [data, setData] = useState<any>(null);
    const [open, setOpen] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedCompany) return;
        api.get('/reports/ageing', { params: { companyId: selectedCompany.id, kind, asOfDate: asOf } })
            .then((r) => setData(r.data.data))
            .catch((e) => notify.error(apiError(e, 'Could not load outstanding')));
    }, [selectedCompany?.id, kind, asOf]);

    const remind = (p: any) => {
        const bills = data.bills.filter((b: any) => b.party_ledger_id === p.ledger_id);
        const lines = bills.map((b: any) => `• ${b.invoice_number} dated ${formatDate(b.date)}: ₹${b.outstanding.toLocaleString('en-IN')}${b.days_overdue > 0 ? ` (${b.days_overdue} days overdue)` : ''}`);
        const msg =
            `Dear ${p.name},\n\nThis is a gentle reminder that ₹${p.net.toLocaleString('en-IN', { minimumFractionDigits: 2 })} is outstanding with ${selectedCompany?.name}:\n\n` +
            `${lines.join('\n')}\n\nKindly arrange the payment at the earliest. Please ignore if already paid.\n\nThank you,\n${selectedCompany?.name}`;
        window.open(`https://wa.me/${waNumber(p.phone)}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
    };

    const fy = currentFinancialYear();
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Outstanding</h1>
                    <p className="text-sm text-slate-500">Who owes you and whom you owe, by how overdue each bill is.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <div className="flex rounded-xl bg-slate-100 p-1">
                        {(['receivable', 'payable'] as Kind[]).map((k) => (
                            <button key={k} onClick={() => setKind(k)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${kind === k ? 'bg-white text-primary shadow' : 'text-slate-600'}`}>
                                {k === 'receivable' ? 'Receivables' : 'Payables'}
                            </button>
                        ))}
                    </div>
                    <label className="text-sm text-slate-600">
                        As on
                        <input type="date" className="input-field ml-2 inline-block w-auto py-1" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                    </label>
                </div>
            </div>

            {data && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                    {BUCKETS.map(([k, l]) => (
                        <div key={k} className={`card py-3 ${k === 'd90_plus' && data.totals[k] ? 'border-red-200 bg-red-50' : ''}`}>
                            <p className="text-xs text-slate-500">{l}</p>
                            <p className="text-lg font-semibold text-slate-800">{inr(data.totals[k])}</p>
                        </div>
                    ))}
                    <div className="card bg-slate-800 py-3 text-white">
                        <p className="text-xs text-slate-300">Net {kind === 'receivable' ? 'to receive' : 'to pay'}</p>
                        <p className="text-lg font-semibold">{inr(data.totals.net)}</p>
                    </div>
                </div>
            )}

            <div className="card overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-600">
                            <th className="px-3 py-2">Party</th>
                            {BUCKETS.map(([k, l]) => (
                                <th key={k} className="px-3 py-2 text-right">{l}</th>
                            ))}
                            <th className="px-3 py-2 text-right">Advances / credits</th>
                            <th className="px-3 py-2 text-right">Net</th>
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {data?.parties.length === 0 && (
                            <tr>
                                <td colSpan={9} className="py-8 text-center text-slate-500">Nothing outstanding 🎉</td>
                            </tr>
                        )}
                        {data?.parties.map((p: any) => (
                            <Fragment key={p.ledger_id}>
                                <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setOpen(open === p.ledger_id ? null : p.ledger_id)}>
                                    <td className="px-3 py-2 font-medium text-slate-800">
                                        <span className="flex items-center gap-1">
                                            {open === p.ledger_id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                            {p.name}
                                        </span>
                                        {Math.abs(p.ledger_balance - p.net) > 0.01 && (
                                            <span className="ml-5 block text-xs text-amber-600" title="Journal entries or opening balances are not linked to bills">
                                                Ledger balance {inr(p.ledger_balance)}
                                            </span>
                                        )}
                                    </td>
                                    {BUCKETS.map(([k]) => (
                                        <td key={k} className={`px-3 py-2 text-right ${k === 'd90_plus' && p.buckets[k] ? 'font-semibold text-red-600' : ''}`}>{inr(p.buckets[k])}</td>
                                    ))}
                                    <td className="px-3 py-2 text-right text-green-700">{p.credits ? `-${inr(p.credits)}` : '—'}</td>
                                    <td className="px-3 py-2 text-right font-semibold">{inr(p.net)}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                        {kind === 'receivable' && p.net > 0 && (
                                            <button onClick={() => remind(p)} className="p-1 text-slate-400 hover:text-green-600" title="Send WhatsApp payment reminder">
                                                <MessageCircle className="h-4 w-4" />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => navigate(`/ledgers/${p.ledger_id}/statement?startDate=${fy.startDate}`)}
                                            className="p-1 text-slate-400 hover:text-primary"
                                            title="Statement of account"
                                        >
                                            <FileText className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                                {open === p.ledger_id &&
                                    data.bills
                                        .filter((b: any) => b.party_ledger_id === p.ledger_id)
                                        .map((b: any) => (
                                            <tr key={b.id} className="border-b border-slate-50 bg-slate-50 text-xs text-slate-600">
                                                <td className="px-3 py-1.5 pl-9">
                                                    <a className="text-primary hover:underline" href={`/invoices/${b.id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${b.id}`); }}>
                                                        {b.invoice_number}
                                                    </a>{' '}
                                                    · {formatDate(b.date)} · due {formatDate(b.due_date || b.date)}
                                                </td>
                                                {BUCKETS.map(([k]) => (
                                                    <td key={k} className="px-3 py-1.5 text-right">{b.bucket === k ? inr(b.outstanding) : ''}</td>
                                                ))}
                                                <td className="px-3 py-1.5 text-right" colSpan={3}>
                                                    {b.days_overdue > 0 ? `${b.days_overdue} days overdue` : 'not yet due'}
                                                </td>
                                            </tr>
                                        ))}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
