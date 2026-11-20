import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, AlertTriangle, ExternalLink } from 'lucide-react';
import api, { apiError } from '../../api/axios';
import { useCompany } from '../../context/CompanyContext';
import { notify } from '../../utils/notification';
import { Button } from '../../components/ui/Button';
import { GstMonthPicker, defaultReturnMonth, monthRange } from '../../components/GstMonthPicker';
import { fetchBlob, saveBlob } from '../../lib/files';
import { formatDate } from '../../lib/dates';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SECTIONS: [string, string, string][] = [
    ['b2b', 'B2B', 'Sales to registered businesses (incl. SEZ, deemed exports)'],
    ['b2cLarge', 'B2C Large', 'Unregistered, other state, invoice above ₹1 lakh'],
    ['b2cSmall', 'B2C Small', 'Other sales to unregistered buyers (consolidated by state and rate)'],
    ['exports', 'Exports', 'Exports with or without payment of IGST'],
    ['cdnr', 'Credit notes (registered)', 'Credit notes issued to registered buyers'],
    ['cdnur', 'Credit notes (unregistered)', 'Credit notes to unregistered buyers'],
];

/** GSTR-1: outward supplies by section, with a portal-ready JSON download. */
export const GSTR1: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [month, setMonth] = useState(defaultReturnMonth());
    const [data, setData] = useState<any>(null);
    const [tab, setTab] = useState('b2b');
    const range = monthRange(month);

    useEffect(() => {
        if (!selectedCompany) return;
        setData(null);
        api.get(`/gst/gstr1/${selectedCompany.id}`, { params: { fromDate: range.from, toDate: range.to } })
            .then((r) => setData(r.data.data))
            .catch((e) => notify.error(apiError(e, 'Could not prepare GSTR-1')));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCompany?.id, month]);

    const downloadJson = async () => {
        if (!selectedCompany) return;
        try {
            const blob = await fetchBlob(`/gst/gstr1/${selectedCompany.id}/json`, { fromDate: range.from, toDate: range.to });
            saveBlob(blob, `GSTR1_${selectedCompany.gstin || ''}_${range.period}.json`);
        } catch (e) {
            notify.error(apiError(e, 'Could not create the JSON file'));
        }
    };

    const rows: any[] = data?.[tab] ?? [];
    const totals = (docs: any[]) =>
        docs.reduce(
            (a, d) => {
                for (const it of d.items) {
                    a.taxable += Number(it.taxable_amount);
                    a.tax += Number(it.igst_amount) + Number(it.cgst_amount) + Number(it.sgst_amount);
                }
                a.value += Number(d.grand_total);
                return a;
            },
            { taxable: 0, tax: 0, value: 0 }
        );

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">GSTR-1</h1>
                    <p className="text-sm text-slate-500">Outward supplies. Download the JSON and upload it on the GST portal (Returns → GSTR-1 → Prepare offline → Upload).</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <GstMonthPicker value={month} onChange={setMonth} />
                    <Button onClick={downloadJson} disabled={!data}>
                        <Download className="h-4 w-4" /> Download JSON
                    </Button>
                </div>
            </div>

            {data?.summary.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    <p className="mb-1 flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4" /> Fix these before filing
                    </p>
                    <ul className="list-disc pl-5">
                        {data.summary.warnings.slice(0, 10).map((w: string) => (
                            <li key={w}>{w}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
                <div className="flex w-max gap-1 rounded-xl bg-slate-100 p-1">
                    {[...SECTIONS, ['hsn', 'HSN summary', ''] as [string, string, string]].map(([k, l]) => (
                        <button
                            key={k}
                            onClick={() => setTab(k)}
                            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-white text-primary shadow' : 'text-slate-600'}`}
                        >
                            {l}
                            {data && k !== 'hsn' && <span className="ml-1 text-xs text-slate-400">({data[k]?.length ?? 0})</span>}
                        </button>
                    ))}
                </div>
            </div>

            <div className="card overflow-x-auto">
                {tab === 'hsn' ? (
                    <HsnTable data={data?.hsn} />
                ) : (
                    <>
                        <p className="mb-3 text-sm text-slate-500">{SECTIONS.find(([k]) => k === tab)?.[2]}</p>
                        <table className="w-full min-w-[720px] text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-left text-slate-600">
                                    <th className="px-3 py-2">Date</th>
                                    <th className="px-3 py-2">Number</th>
                                    <th className="px-3 py-2">Party</th>
                                    <th className="px-3 py-2">GSTIN</th>
                                    <th className="px-3 py-2">Place of supply</th>
                                    <th className="px-3 py-2 text-right">Taxable</th>
                                    <th className="px-3 py-2 text-right">Tax</th>
                                    <th className="px-3 py-2 text-right">Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 && (
                                    <tr><td colSpan={8} className="py-8 text-center text-slate-500">{data ? 'Nothing in this section' : 'Loading…'}</td></tr>
                                )}
                                {rows.map((d) => {
                                    const t = totals([d]);
                                    return (
                                        <tr key={d.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/invoices/${d.id}`)}>
                                            <td className="whitespace-nowrap px-3 py-2">{formatDate(d.date)}</td>
                                            <td className="px-3 py-2">{d.invoice_number} <ExternalLink className="inline h-3 w-3 text-slate-300" /></td>
                                            <td className="px-3 py-2">{d.party_name}</td>
                                            <td className="px-3 py-2 font-mono text-xs">{d.party_gstin || '—'}</td>
                                            <td className="px-3 py-2">{d.place_of_supply || <span className="text-red-600">missing</span>}</td>
                                            <td className="px-3 py-2 text-right">{inr(t.taxable)}</td>
                                            <td className="px-3 py-2 text-right">{inr(t.tax)}</td>
                                            <td className="px-3 py-2 text-right font-medium">{inr(t.value)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            {rows.length > 0 && (
                                <tfoot>
                                    {(() => {
                                        const t = totals(rows);
                                        return (
                                            <tr className="font-semibold">
                                                <td colSpan={5} className="px-3 py-2 text-right">Total</td>
                                                <td className="px-3 py-2 text-right">{inr(t.taxable)}</td>
                                                <td className="px-3 py-2 text-right">{inr(t.tax)}</td>
                                                <td className="px-3 py-2 text-right">{inr(t.value)}</td>
                                            </tr>
                                        );
                                    })()}
                                </tfoot>
                            )}
                        </table>
                    </>
                )}
            </div>
        </div>
    );
};

const HsnTable: React.FC<{ data?: { b2b: any[]; b2c: any[] } }> = ({ data }) => {
    if (!data) return <p className="py-8 text-center text-slate-500">Loading…</p>;
    const block = (title: string, rows: any[]) => (
        <div className="mb-6">
            <h3 className="mb-2 font-semibold text-slate-700">{title}</h3>
            <table className="w-full min-w-[760px] text-sm">
                <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-600">
                        <th className="px-3 py-2">HSN/SAC</th>
                        <th className="px-3 py-2">Description</th>
                        <th className="px-3 py-2">UQC</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Rate</th>
                        <th className="px-3 py-2 text-right">Taxable</th>
                        <th className="px-3 py-2 text-right">IGST</th>
                        <th className="px-3 py-2 text-right">CGST</th>
                        <th className="px-3 py-2 text-right">SGST</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-slate-500">None</td></tr>}
                    {rows.map((h) => (
                        <tr key={h.num} className="border-b border-slate-100">
                            <td className="px-3 py-2 font-mono">{h.hsn_sc || <span className="text-red-600">missing</span>}</td>
                            <td className="px-3 py-2">{h.desc}</td>
                            <td className="px-3 py-2">{h.uqc}</td>
                            <td className="px-3 py-2 text-right">{h.qty}</td>
                            <td className="px-3 py-2 text-right">{h.rt}%</td>
                            <td className="px-3 py-2 text-right">{inr(h.txval)}</td>
                            <td className="px-3 py-2 text-right">{inr(h.iamt)}</td>
                            <td className="px-3 py-2 text-right">{inr(h.camt)}</td>
                            <td className="px-3 py-2 text-right">{inr(h.samt)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
    return (
        <>
            {block('B2B (to registered buyers)', data.b2b)}
            {block('B2C (to unregistered buyers)', data.b2c)}
        </>
    );
};
