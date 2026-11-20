import React, { useEffect, useState } from 'react';
import api, { apiError } from '../../api/axios';
import { useCompany } from '../../context/CompanyContext';
import { notify } from '../../utils/notification';
import { formatDate, today } from '../../lib/dates';
import { amount, inr } from '../../lib/format';

interface Row {
    item_id: string;
    name: string;
    unit: string | null;
    quantity: number;
    rate: number;
    value: number;
}

/** Stock on hand with its value at weighted average cost: the closing stock in the P&L and Balance Sheet. */
export const StockSummary: React.FC = () => {
    const { selectedCompany } = useCompany();
    const [asOf, setAsOf] = useState(today());
    const [data, setData] = useState<{ items: Row[]; totalValue: number } | null>(null);

    useEffect(() => {
        if (!selectedCompany) return;
        api.get('/reports/stock-summary', { params: { companyId: selectedCompany.id, asOfDate: asOf } })
            .then((r) => setData(r.data.data))
            .catch((e) => notify.error(apiError(e, 'Could not load stock summary')));
    }, [selectedCompany?.id, asOf]);

    const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Stock Summary</h1>
                    <p className="text-sm text-slate-500">
                        Stock on hand as on {formatDate(asOf)}, valued at weighted average cost. This value is the closing stock in your Profit &amp; Loss and Balance Sheet.
                    </p>
                </div>
                <label className="text-sm">
                    As on <input type="date" className="input-field inline-block w-auto py-1" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                </label>
            </div>

            {data && (
                <div className="card overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-left text-slate-600">
                                <th className="px-3 py-2">Item</th>
                                <th className="px-3 py-2 text-right">Quantity</th>
                                <th className="px-3 py-2 text-right">Average cost</th>
                                <th className="px-3 py-2 text-right">Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.items.length === 0 && (
                                <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">No stock items yet.</td></tr>
                            )}
                            {data.items.map((r) => (
                                <tr key={r.item_id} className="border-b border-slate-100">
                                    <td className="px-3 py-2 font-medium text-slate-800">{r.name}</td>
                                    <td className={`px-3 py-2 text-right tabular-nums ${r.quantity < 0 ? 'text-red-600' : ''}`}>
                                        {qty(r.quantity)} {r.unit}
                                        {r.quantity < 0 && <span className="block text-xs">negative stock: check entries</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">{r.quantity > 0 ? amount(r.rate) : '—'}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{inr(r.value)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="font-semibold text-slate-900">
                                <td className="px-3 py-2" colSpan={3}>Total stock value</td>
                                <td className="px-3 py-2 text-right tabular-nums">{inr(data.totalValue)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
};
