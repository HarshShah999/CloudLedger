import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { apiError } from '../../api/axios';
import { useCompany } from '../../context/CompanyContext';
import { notify } from '../../utils/notification';
import { currentFinancialYear, formatDate, today } from '../../lib/dates';

const inr = (n: number) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Cash Book / Bank Book: running balance of one cash or bank account. */
export const CashBankBook: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [ledgers, setLedgers] = useState<any[]>([]);
    const [ledgerId, setLedgerId] = useState('');
    const [from, setFrom] = useState(currentFinancialYear().startDate);
    const [to, setTo] = useState(today());
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (!selectedCompany) return;
        api.get('/ledgers', { params: { companyId: selectedCompany.id } }).then((r) => {
            const list = r.data.data.ledgers.filter(
                (l: any) => ['CASH_IN_HAND', 'BANK_ACCOUNTS', 'BANK_OD'].includes(l.group_code) || /cash|bank/i.test(l.group_name || '')
            );
            setLedgers(list);
            setLedgerId((cur) => cur || list[0]?.id || '');
        });
    }, [selectedCompany?.id]);

    useEffect(() => {
        if (!selectedCompany || !ledgerId) return;
        api.get(`/ledgers/${ledgerId}/statement`, { params: { companyId: selectedCompany.id, startDate: from, endDate: to } })
            .then((r) => setData(r.data.data))
            .catch((e) => notify.error(apiError(e, 'Could not load the book')));
    }, [selectedCompany?.id, ledgerId, from, to]);

    const isCash = useMemo(() => /cash/i.test(ledgers.find((l) => l.id === ledgerId)?.group_name || ''), [ledgers, ledgerId]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">{isCash ? 'Cash Book' : 'Bank Book'}</h1>
                    <p className="text-sm text-slate-500">Money in and out of an account, with the running balance.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2 text-sm">
                    <select className="input-field w-auto py-1" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
                        {ledgers.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                    </select>
                    <label>From <input type="date" className="input-field inline-block w-auto py-1" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                    <label>To <input type="date" className="input-field inline-block w-auto py-1" value={to} onChange={(e) => setTo(e.target.value)} /></label>
                </div>
            </div>

            {data && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="card py-3"><p className="text-xs text-slate-500">Opening</p><p className="font-semibold">₹{inr(data.ledger.opening_balance)} {data.ledger.opening_balance_type}</p></div>
                    <div className="card py-3"><p className="text-xs text-slate-500">Money in</p><p className="font-semibold text-green-700">₹{inr(data.ledger.total_debit)}</p></div>
                    <div className="card py-3"><p className="text-xs text-slate-500">Money out</p><p className="font-semibold text-red-600">₹{inr(data.ledger.total_credit)}</p></div>
                    <div className="card bg-slate-800 py-3 text-white"><p className="text-xs text-slate-300">Closing</p><p className="font-semibold">₹{inr(data.ledger.closing_balance)} {data.ledger.closing_balance_type}</p></div>
                </div>
            )}

            <div className="card overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-600">
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Particulars</th>
                            <th className="px-3 py-2">Voucher</th>
                            <th className="px-3 py-2 text-right">In</th>
                            <th className="px-3 py-2 text-right">Out</th>
                            <th className="px-3 py-2 text-right">Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data?.transactions.length === 0 && (
                            <tr><td colSpan={6} className="py-8 text-center text-slate-500">No transactions in this period</td></tr>
                        )}
                        {data?.transactions.map((t: any) => (
                            <tr
                                key={t.id}
                                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                                onClick={() => navigate(t.invoice_id ? `/invoices/${t.invoice_id}` : `/vouchers/edit/${t.voucher_id}`)}
                            >
                                <td className="whitespace-nowrap px-3 py-2">{formatDate(t.date)}</td>
                                <td className="px-3 py-2">
                                    {t.particulars || '—'}
                                    {t.narration && <span className="block text-xs text-slate-400">{t.narration}</span>}
                                </td>
                                <td className="px-3 py-2">{t.voucher_type_name}<span className="block text-xs text-slate-400">{t.voucher_number}</span></td>
                                <td className="px-3 py-2 text-right font-mono text-green-700">{t.debit ? inr(t.debit) : ''}</td>
                                <td className="px-3 py-2 text-right font-mono text-red-600">{t.credit ? inr(t.credit) : ''}</td>
                                <td className="px-3 py-2 text-right font-mono">{inr(t.balance)} {t.balance_type}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
