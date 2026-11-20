import React, { useEffect, useState } from 'react';
import api, { apiError } from '../../api/axios';
import { useCompany } from '../../context/CompanyContext';
import { notify } from '../../utils/notification';
import { GstMonthPicker, defaultReturnMonth, monthRange } from '../../components/GstMonthPicker';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ROWS: [string, string][] = [
    ['3.1(a)', 'Outward taxable supplies (other than zero-rated, nil-rated and exempted)'],
    ['3.1(b)', 'Outward taxable supplies (zero-rated: exports & SEZ)'],
    ['3.1(c)', 'Other outward supplies (nil-rated, exempted)'],
    ['3.1(d)', 'Inward supplies liable to reverse charge'],
    ['4(A)(3)', 'ITC: inward supplies liable to reverse charge'],
    ['4(A)(5)', 'ITC: all other ITC (net of purchase returns)'],
];

/** GSTR-3B figures computed from the books, laid out like the portal form. */
export const GSTR3B: React.FC = () => {
    const { selectedCompany } = useCompany();
    const [month, setMonth] = useState(defaultReturnMonth());
    const [data, setData] = useState<any>(null);
    const range = monthRange(month);

    useEffect(() => {
        if (!selectedCompany) return;
        api.get(`/gst/gstr3b/${selectedCompany.id}`, { params: { fromDate: range.from, toDate: range.to } })
            .then((r) => setData(r.data.data))
            .catch((e) => notify.error(apiError(e, 'Could not prepare GSTR-3B')));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCompany?.id, month]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">GSTR-3B</h1>
                    <p className="text-sm text-slate-500">Summary to enter on the GST portal. Check ITC against GSTR-2B before filing.</p>
                </div>
                <GstMonthPicker value={month} onChange={setMonth} />
            </div>

            <div className="card overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-600">
                            <th className="px-3 py-2">Table</th>
                            <th className="px-3 py-2">Nature of supply</th>
                            <th className="px-3 py-2 text-right">Taxable value</th>
                            <th className="px-3 py-2 text-right">IGST</th>
                            <th className="px-3 py-2 text-right">CGST</th>
                            <th className="px-3 py-2 text-right">SGST</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ROWS.map(([k, label]) => {
                            const r = data?.tables[k];
                            return (
                                <tr key={k} className="border-b border-slate-100">
                                    <td className="px-3 py-2 font-mono text-xs">{k}</td>
                                    <td className="px-3 py-2">{label}</td>
                                    <td className="px-3 py-2 text-right">{r && !k.startsWith('4') ? inr(r.taxable_value) : ''}</td>
                                    <td className="px-3 py-2 text-right">{r ? inr(r.igst) : '…'}</td>
                                    <td className="px-3 py-2 text-right">{r ? inr(r.cgst) : '…'}</td>
                                    <td className="px-3 py-2 text-right">{r ? inr(r.sgst) : '…'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {data && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {[
                        ['Tax liability', data.liability],
                        ['Input tax credit', data.itc],
                        ['Net payable (approx.)', data.net_payable],
                    ].map(([title, v]: any) => (
                        <div key={title} className={`card ${title.startsWith('Net') ? 'bg-slate-800 text-white' : ''}`}>
                            <p className={`text-xs ${title.startsWith('Net') ? 'text-slate-300' : 'text-slate-500'}`}>{title}</p>
                            <p className="text-sm">IGST {inr(v.igst)}</p>
                            <p className="text-sm">CGST {inr(v.cgst)}</p>
                            <p className="text-sm">SGST {inr(v.sgst)}</p>
                        </div>
                    ))}
                </div>
            )}
            {data && (data.rcm_cash.igst + data.rcm_cash.cgst + data.rcm_cash.sgst > 0) && (
                <p className="text-sm text-amber-700">
                    Tax under reverse charge ({inr(data.rcm_cash.igst + data.rcm_cash.cgst + data.rcm_cash.sgst)}) must be paid in cash; its ITC can be claimed in the same return.
                </p>
            )}
            <p className="text-xs text-slate-400">Net payable ignores the order of ITC set-off (section 49) and any interest or late fee; the portal computes the final figures.</p>
        </div>
    );
};
