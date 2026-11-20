import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiError } from '../../api/axios';
import { useCompany } from '../../context/CompanyContext';
import { notify } from '../../utils/notification';
import { currentFinancialYear, formatDate, today } from '../../lib/dates';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** TDS deducted on purchase bills, by section: the working for challan payment and Form 26Q. */
export const TdsRegister: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [from, setFrom] = useState(currentFinancialYear().startDate);
    const [to, setTo] = useState(today());
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (!selectedCompany) return;
        api.get(`/gst/tds/${selectedCompany.id}`, { params: { fromDate: from, toDate: to } })
            .then((r) => setData(r.data.data))
            .catch((e) => notify.error(apiError(e, 'Could not load TDS')));
    }, [selectedCompany?.id, from, to]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">TDS Register</h1>
                    <p className="text-sm text-slate-500">TDS deducted on purchase bills. Deposit it by the 7th of the next month and include it in Form 26Q.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2 text-sm">
                    <label>From <input type="date" className="input-field inline-block w-auto py-1" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                    <label>To <input type="date" className="input-field inline-block w-auto py-1" value={to} onChange={(e) => setTo(e.target.value)} /></label>
                </div>
            </div>

            {data && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {data.sections.map((s: any) => (
                        <div key={s.section} className="card py-3">
                            <p className="text-xs text-slate-500">Section {s.section} · {s.count} bill{s.count === 1 ? '' : 's'}</p>
                            <p className="text-lg font-semibold">{inr(s.tds)}</p>
                            <p className="text-xs text-slate-400">on {inr(s.base)}</p>
                        </div>
                    ))}
                    <div className="card bg-slate-800 py-3 text-white"><p className="text-xs text-slate-300">Total TDS</p><p className="text-lg font-semibold">{inr(data.total)}</p></div>
                </div>
            )}
            {data?.missingPan.length > 0 && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                    PAN missing for: {[...new Set(data.missingPan)].join(', ')}. Without PAN, TDS must be deducted at a higher rate (section 206AA).
                </p>
            )}

            <div className="card overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-600">
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Bill</th>
                            <th className="px-3 py-2">Deductee</th>
                            <th className="px-3 py-2">PAN</th>
                            <th className="px-3 py-2">Section</th>
                            <th className="px-3 py-2 text-right">Amount</th>
                            <th className="px-3 py-2 text-right">Rate</th>
                            <th className="px-3 py-2 text-right">TDS</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data?.entries.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-slate-500">No TDS deducted in this period</td></tr>}
                        {data?.entries.map((e: any) => (
                            <tr key={e.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/invoices/${e.id}`)}>
                                <td className="whitespace-nowrap px-3 py-2">{formatDate(e.date)}</td>
                                <td className="px-3 py-2">{e.invoice_number}</td>
                                <td className="px-3 py-2">{e.party_name}</td>
                                <td className="px-3 py-2 font-mono text-xs">{e.party_pan || <span className="text-red-600">missing</span>}</td>
                                <td className="px-3 py-2">{e.tds_section}</td>
                                <td className="px-3 py-2 text-right">{inr(e.subtotal)}</td>
                                <td className="px-3 py-2 text-right">{e.tds_rate}%</td>
                                <td className="px-3 py-2 text-right font-medium">{inr(e.tds_amount)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
