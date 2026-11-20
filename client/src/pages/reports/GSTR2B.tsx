import React, { useEffect, useState } from 'react';
import { Upload, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import api, { apiError } from '../../api/axios';
import { useCompany } from '../../context/CompanyContext';
import { notify } from '../../utils/notification';
import { GstMonthPicker, defaultReturnMonth, monthRange } from '../../components/GstMonthPicker';
import { formatDate } from '../../lib/dates';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tax = (x: any) => Number(x.igst || 0) + Number(x.cgst || 0) + Number(x.sgst || 0);

/** Upload GSTR-2B from the portal and match it with purchase bills in the books. */
export const GSTR2B: React.FC = () => {
    const { selectedCompany, canWrite } = useCompany();
    const [month, setMonth] = useState(defaultReturnMonth());
    const [data, setData] = useState<any>(null);
    const [status, setStatus] = useState<'idle' | 'loading' | 'none'>('idle');
    const [tab, setTab] = useState<'mismatched' | 'missingInBooks' | 'missingIn2b' | 'matched'>('mismatched');
    const period = monthRange(month).period;

    const load = () => {
        if (!selectedCompany) return;
        setStatus('loading');
        api.get(`/gst/gstr2b/${selectedCompany.id}/${period}`)
            .then((r) => {
                setData(r.data.data);
                setStatus('idle');
            })
            .catch((e) => {
                setData(null);
                setStatus(e.response?.status === 404 ? 'none' : 'idle');
                if (e.response?.status !== 404) notify.error(apiError(e, 'Could not load'));
            });
    };
    useEffect(load, [selectedCompany?.id, period]); // eslint-disable-line react-hooks/exhaustive-deps

    const upload = async (file?: File) => {
        if (!file || !selectedCompany) return;
        try {
            const content = await file.text();
            await api.post(`/gst/gstr2b/${selectedCompany.id}`, { content, fileName: file.name, period });
            notify.success('GSTR-2B uploaded');
            load();
        } catch (e) {
            notify.error(apiError(e, 'Upload failed'));
        }
    };

    const s = data?.summary;
    const tabs: [typeof tab, string, number | undefined, React.ReactNode][] = [
        ['mismatched', 'Amounts differ', s?.mismatched, <AlertTriangle key="a" className="h-4 w-4 text-amber-500" />],
        ['missingInBooks', 'In 2B, not in books', s?.missingInBooks, <HelpCircle key="b" className="h-4 w-4 text-blue-500" />],
        ['missingIn2b', 'In books, not in 2B', s?.missingIn2b, <XCircle key="c" className="h-4 w-4 text-red-500" />],
        ['matched', 'Matched', s?.matched, <CheckCircle2 key="d" className="h-4 w-4 text-green-600" />],
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">GSTR-2B matching</h1>
                    <p className="text-sm text-slate-500">
                        Download GSTR-2B as JSON from the GST portal (Returns → GSTR-2B → Download JSON) and upload it here to check your input tax credit.
                    </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <GstMonthPicker value={month} onChange={setMonth} />
                    {canWrite && (
                        <label className="btn btn-primary cursor-pointer">
                            <Upload className="h-4 w-4" /> Upload 2B JSON
                            <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
                        </label>
                    )}
                </div>
            </div>

            {status === 'none' && <div className="card py-10 text-center text-slate-500">No GSTR-2B uploaded for this month yet.</div>}

            {data && (
                <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="card py-3"><p className="text-xs text-slate-500">ITC available as per 2B</p><p className="text-lg font-semibold">{inr(s.itcAsPer2b)}</p></div>
                        <div className="card py-3"><p className="text-xs text-slate-500">ITC on matched bills</p><p className="text-lg font-semibold text-green-700">{inr(s.itcMatched)}</p></div>
                        <div className="card border-red-200 bg-red-50 py-3"><p className="text-xs text-slate-500">ITC at risk (supplier hasn’t filed)</p><p className="text-lg font-semibold text-red-600">{inr(s.itcAtRisk)}</p></div>
                    </div>

                    <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
                        <div className="flex w-max gap-1 rounded-xl bg-slate-100 p-1">
                            {tabs.map(([k, l, n, icon]) => (
                                <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-white text-primary shadow' : 'text-slate-600'}`}>
                                    {icon} {l} <span className="text-xs text-slate-400">({n})</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="card overflow-x-auto">
                        <table className="w-full min-w-[760px] text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-left text-slate-600">
                                    <th className="px-3 py-2">Supplier</th>
                                    <th className="px-3 py-2">Invoice</th>
                                    <th className="px-3 py-2">Date</th>
                                    <th className="px-3 py-2 text-right">Taxable</th>
                                    <th className="px-3 py-2 text-right">Tax</th>
                                    {(tab === 'mismatched' || tab === 'matched') && <th className="px-3 py-2 text-right">Difference (2B − books)</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {(data[tab] as any[]).length === 0 && (
                                    <tr><td colSpan={6} className="py-8 text-center text-slate-500">Nothing here</td></tr>
                                )}
                                {(data[tab] as any[]).map((r, i) => {
                                    const p = r.portal ?? r;
                                    const b = r.books;
                                    return (
                                        <tr key={i} className="border-b border-slate-100">
                                            <td className="px-3 py-2">{p.supplier}<span className="block font-mono text-xs text-slate-400">{p.ctin ?? p.gstin}</span></td>
                                            <td className="px-3 py-2">{p.number}{b && b.number !== p.number && <span className="block text-xs text-slate-400">books: {b.number}</span>}</td>
                                            <td className="px-3 py-2">{formatDate(p.date)}</td>
                                            <td className="px-3 py-2 text-right">{inr(p.taxable)}</td>
                                            <td className="px-3 py-2 text-right">{inr(tax(p))}</td>
                                            {(tab === 'mismatched' || tab === 'matched') && (
                                                <td className="px-3 py-2 text-right text-amber-700">
                                                    {r.diff.taxable ? `taxable ${inr(r.diff.taxable)} ` : ''}
                                                    {tax(r.diff) ? `tax ${inr(tax(r.diff))}` : ''}
                                                    {!r.diff.taxable && !tax(r.diff) ? '—' : ''}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-xs text-slate-400">
                        Uploaded {new Date(data.uploadedAt).toLocaleString('en-IN')} · {data.fileName}. Invoice numbers are compared ignoring spaces, slashes, dashes and leading zeros; amounts within ₹1 count as matched.
                    </p>
                </>
            )}
        </div>
    );
};
