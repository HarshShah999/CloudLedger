import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiError } from '../../api/axios';
import { useCompany } from '../../context/CompanyContext';
import { notify } from '../../utils/notification';
import { formatDate, today } from '../../lib/dates';

const inr = (n: number) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Every voucher for a period with its debit and credit lines. */
export const DayBook: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [from, setFrom] = useState(today());
    const [to, setTo] = useState(today());
    const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
    const [typeId, setTypeId] = useState('');
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (!selectedCompany) return;
        api.get('/vouchers/types', { params: { companyId: selectedCompany.id } }).then((r) => setTypes(r.data.data.voucherTypes));
    }, [selectedCompany?.id]);

    useEffect(() => {
        if (!selectedCompany) return;
        api.get('/reports/day-book', { params: { companyId: selectedCompany.id, startDate: from, endDate: to, voucherTypeId: typeId || undefined } })
            .then((r) => setData(r.data.data))
            .catch((e) => notify.error(apiError(e, 'Could not load day book')));
    }, [selectedCompany?.id, from, to, typeId]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Day Book</h1>
                    <p className="text-sm text-slate-500">All entries for the selected days.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2 text-sm">
                    <label>From <input type="date" className="input-field inline-block w-auto py-1" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                    <label>To <input type="date" className="input-field inline-block w-auto py-1" value={to} onChange={(e) => setTo(e.target.value)} /></label>
                    <select className="input-field w-auto py-1" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                        <option value="">All voucher types</option>
                        {types.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="card overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-600">
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Type / No.</th>
                            <th className="px-3 py-2">Particulars</th>
                            <th className="px-3 py-2 text-right">Debit</th>
                            <th className="px-3 py-2 text-right">Credit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data?.vouchers.length === 0 && (
                            <tr>
                                <td colSpan={5} className="py-8 text-center text-slate-500">No entries in this period</td>
                            </tr>
                        )}
                        {data?.vouchers.map((v: any) => (
                            <tr
                                key={v.id}
                                className="cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50"
                                onClick={() => navigate(v.invoice_id ? `/invoices/${v.invoice_id}` : `/vouchers/edit/${v.id}`)}
                            >
                                <td className="whitespace-nowrap px-3 py-2">{formatDate(v.date)}</td>
                                <td className="px-3 py-2">
                                    {v.voucher_type}
                                    <span className="block text-xs text-slate-400">{v.voucher_number}</span>
                                </td>
                                <td className="px-3 py-2">
                                    {v.entries.map((e: any, i: number) => (
                                        <p key={i} className={e.type === 'Cr' ? 'pl-6 text-slate-600' : 'text-slate-800'}>
                                            {e.type === 'Cr' ? 'To ' : ''}{e.ledger}
                                        </p>
                                    ))}
                                    {v.narration && <p className="mt-1 text-xs italic text-slate-400">{v.narration}</p>}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                    {v.entries.map((e: any, i: number) => <p key={i}>{e.type === 'Dr' ? inr(e.amount) : ' '}</p>)}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                    {v.entries.map((e: any, i: number) => <p key={i}>{e.type === 'Cr' ? inr(e.amount) : ' '}</p>)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {data?.vouchers.length > 0 && (
                        <tfoot>
                            <tr className="font-semibold">
                                <td colSpan={3} className="px-3 py-2 text-right">Total</td>
                                <td className="px-3 py-2 text-right font-mono">{inr(data.total)}</td>
                                <td className="px-3 py-2 text-right font-mono">{inr(data.total)}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
};
