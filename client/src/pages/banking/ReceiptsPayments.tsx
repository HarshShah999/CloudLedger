import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Trash2, Wand2, X, Link2 } from 'lucide-react';
import api, { apiError } from '../../api/axios';
import { useCompany } from '../../context/CompanyContext';
import { notify } from '../../utils/notification';
import { Button } from '../../components/ui/Button';
import { formatDate, today } from '../../lib/dates';
import { docInfo } from '../../lib/docTypes';

type Direction = 'RECEIPT' | 'PAYMENT';
const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Ledger { id: string; name: string; group_name?: string; group_code?: string; group_type?: string }
interface OpenInvoice { id: string; invoice_number: string; type: string; date: string; due_date: string | null; grand_total: number; outstanding: number }
interface Receipt {
    id: string; date: string; direction: Direction; party_name: string; party_ledger_id: string; amount: number;
    allocated: number; unallocated: number; deposit_ledger_name: string; payment_mode: string | null;
    reference_number: string | null; voucher_number: string; allocations: { invoice_number: string; amount: number }[];
}

const isCashBank = (l: Ledger) => ['CASH_IN_HAND', 'BANK_ACCOUNTS', 'BANK_OD'].includes(l.group_code || '') || /cash|bank/i.test(l.group_name || '');

/** Allocation grid: open bills with an amount box each, plus auto-fill oldest first. */
const AllocationTable: React.FC<{
    invoices: OpenInvoice[];
    alloc: Record<string, string>;
    setAlloc: (a: Record<string, string>) => void;
    available: number;
}> = ({ invoices, alloc, setAlloc, available }) => {
    const autoFill = () => {
        let left = Math.round(available * 100);
        const next: Record<string, string> = {};
        for (const inv of invoices) {
            const take = Math.min(left, Math.round(inv.outstanding * 100));
            if (take > 0) next[inv.id] = (take / 100).toFixed(2);
            left -= take;
        }
        setAlloc(next);
    };
    if (!invoices.length) return <p className="text-sm text-slate-500">No open bills for this party. The full amount will be kept as an advance.</p>;
    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Settle against bills</p>
                <button type="button" onClick={autoFill} className="flex items-center gap-1 text-sm text-primary hover:underline">
                    <Wand2 className="h-4 w-4" /> Auto-fill oldest first
                </button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                        <tr>
                            <th className="px-3 py-2">Bill</th>
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Due</th>
                            <th className="px-3 py-2 text-right">Outstanding</th>
                            <th className="px-3 py-2 text-right">Settle now</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoices.map((inv) => (
                            <tr key={inv.id} className="border-t border-slate-100">
                                <td className="px-3 py-2">
                                    {inv.invoice_number}
                                    <span className="block text-xs text-slate-400">{docInfo(inv.type).label}</span>
                                </td>
                                <td className="px-3 py-2">{formatDate(inv.date)}</td>
                                <td className="px-3 py-2">{formatDate(inv.due_date)}</td>
                                <td className="px-3 py-2 text-right">{inr(inv.outstanding)}</td>
                                <td className="px-3 py-2 text-right">
                                    <input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        max={inv.outstanding}
                                        className="input-field w-28 py-1 text-right"
                                        value={alloc[inv.id] || ''}
                                        onChange={(e) => setAlloc({ ...alloc, [inv.id]: e.target.value })}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const allocationsFrom = (alloc: Record<string, string>) =>
    Object.entries(alloc)
        .map(([invoiceId, v]) => ({ invoiceId, amount: Number(v) }))
        .filter((a) => a.amount > 0);

/** Receive money from customers / pay suppliers, settling bills bill-by-bill (Tally-style). */
export const ReceiptsPayments: React.FC = () => {
    const { selectedCompany, canWrite } = useCompany();
    const [ledgers, setLedgers] = useState<Ledger[]>([]);
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [direction, setDirection] = useState<Direction | null>(null);
    const [form, setForm] = useState({ partyLedgerId: '', date: today(), amount: '', depositLedgerId: '', paymentMode: 'UPI', referenceNumber: '', notes: '' });
    const [openInv, setOpenInv] = useState<OpenInvoice[]>([]);
    const [alloc, setAlloc] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [allocating, setAllocating] = useState<Receipt | null>(null);

    const cashBank = useMemo(() => ledgers.filter(isCashBank), [ledgers]);
    const parties = useMemo(() => ledgers.filter((l) => !isCashBank(l) && (l.group_type === 'Asset' || l.group_type === 'Liability')), [ledgers]);

    const load = async () => {
        if (!selectedCompany) return;
        const [l, r] = await Promise.all([
            api.get('/ledgers', { params: { companyId: selectedCompany.id } }),
            api.get('/receipts', { params: { companyId: selectedCompany.id } }),
        ]);
        setLedgers(l.data.data.ledgers);
        setReceipts(r.data.data.receipts);
    };
    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCompany?.id]);

    const loadOpen = async (partyLedgerId: string, dir: Direction) => {
        setAlloc({});
        if (!partyLedgerId || !selectedCompany) return setOpenInv([]);
        const r = await api.get('/receipts/open-invoices', { params: { companyId: selectedCompany.id, partyLedgerId, direction: dir } });
        setOpenInv(r.data.data.invoices);
    };

    const start = (dir: Direction) => {
        setDirection(dir);
        setForm({ partyLedgerId: '', date: today(), amount: '', depositLedgerId: cashBank.find((l) => !/cash/i.test(l.group_name || ''))?.id || cashBank[0]?.id || '', paymentMode: 'UPI', referenceNumber: '', notes: '' });
        setOpenInv([]);
        setAlloc({});
    };

    const allocatedTotal = allocationsFrom(alloc).reduce((s, a) => s + a.amount, 0);
    const advance = Number(form.amount || 0) - allocatedTotal;

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany || !direction) return;
        setSaving(true);
        try {
            await api.post('/receipts', { companyId: selectedCompany.id, direction, ...form, amount: Number(form.amount), allocations: allocationsFrom(alloc) });
            notify.success(direction === 'RECEIPT' ? 'Receipt saved' : 'Payment saved');
            setDirection(null);
            load();
        } catch (err) {
            notify.error(apiError(err, 'Could not save'));
        } finally {
            setSaving(false);
        }
    };

    const remove = async (r: Receipt) => {
        if (!confirm(`Delete ${r.direction === 'RECEIPT' ? 'receipt' : 'payment'} ${r.voucher_number} of ${inr(r.amount)}? The bills it settled will be outstanding again.`)) return;
        try {
            await api.delete(`/receipts/${r.id}`);
            load();
        } catch (err) {
            notify.error(apiError(err, 'Could not delete'));
        }
    };

    const startAllocate = async (r: Receipt) => {
        setAllocating(r);
        await loadOpen(r.party_ledger_id, r.direction);
    };

    const saveAllocation = async () => {
        if (!allocating) return;
        setSaving(true);
        try {
            await api.post(`/receipts/${allocating.id}/allocate`, { allocations: allocationsFrom(alloc) });
            notify.success('Advance adjusted against bills');
            setAllocating(null);
            load();
        } catch (err) {
            notify.error(apiError(err, 'Could not allocate'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Receipts & Payments</h1>
                    <p className="text-sm text-slate-500">Money received from customers and paid to suppliers, settled bill by bill.</p>
                </div>
                {canWrite && (
                    <div className="flex gap-2">
                        <Button onClick={() => start('RECEIPT')}>
                            <ArrowDownCircle className="h-4 w-4" /> Receive money
                        </Button>
                        <Button variant="secondary" onClick={() => start('PAYMENT')}>
                            <ArrowUpCircle className="h-4 w-4" /> Pay money
                        </Button>
                    </div>
                )}
            </div>

            {direction && (
                <form onSubmit={save} className="card space-y-4 border-2 border-indigo-100">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-slate-800">{direction === 'RECEIPT' ? 'Receive money' : 'Pay money'}</h2>
                        <button type="button" onClick={() => setDirection(null)} className="text-slate-400 hover:text-slate-600" aria-label="Close">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                            {direction === 'RECEIPT' ? 'Received from' : 'Paid to'}
                            <select
                                className="input-field mt-1"
                                required
                                value={form.partyLedgerId}
                                onChange={(e) => {
                                    setForm({ ...form, partyLedgerId: e.target.value });
                                    loadOpen(e.target.value, direction);
                                }}
                            >
                                <option value="">Select party</option>
                                {parties.map((l) => (
                                    <option key={l.id} value={l.id}>{l.name}</option>
                                ))}
                            </select>
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Date
                            <input type="date" className="input-field mt-1" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Amount (₹)
                            <input type="number" min="0.01" step="0.01" className="input-field mt-1" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            {direction === 'RECEIPT' ? 'Into account' : 'From account'}
                            <select className="input-field mt-1" required value={form.depositLedgerId} onChange={(e) => setForm({ ...form, depositLedgerId: e.target.value })}>
                                <option value="">Select cash / bank</option>
                                {cashBank.map((l) => (
                                    <option key={l.id} value={l.id}>{l.name}</option>
                                ))}
                            </select>
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Mode
                            <select className="input-field mt-1" value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
                                {['UPI', 'NEFT/RTGS/IMPS', 'Cheque', 'Cash', 'Card'].map((m) => (
                                    <option key={m}>{m}</option>
                                ))}
                            </select>
                        </label>
                        <label className="text-sm font-medium text-slate-700">
                            Reference (UTR / cheque no.)
                            <input className="input-field mt-1" value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} />
                        </label>
                        <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                            Narration
                            <input className="input-field mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                        </label>
                    </div>

                    {form.partyLedgerId && <AllocationTable invoices={openInv} alloc={alloc} setAlloc={setAlloc} available={Number(form.amount || 0)} />}

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm">
                        <p className="text-slate-600">
                            Settling {inr(allocatedTotal)}
                            {advance > 0.004 && <> · <span className="font-medium text-amber-700">{inr(advance)} kept as advance</span></>}
                            {advance < -0.004 && <> · <span className="font-medium text-red-600">more than the amount</span></>}
                        </p>
                        <Button type="submit" isLoading={saving} disabled={advance < -0.004}>
                            Save {direction === 'RECEIPT' ? 'receipt' : 'payment'}
                        </Button>
                    </div>
                </form>
            )}

            <div className="card overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-slate-600">
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">No.</th>
                            <th className="px-3 py-2">Party</th>
                            <th className="px-3 py-2">Account</th>
                            <th className="px-3 py-2">Settled bills</th>
                            <th className="px-3 py-2 text-right">Amount</th>
                            <th className="px-3 py-2 text-right">Advance</th>
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {receipts.length === 0 && (
                            <tr>
                                <td colSpan={8} className="py-8 text-center text-slate-500">No receipts or payments yet</td>
                            </tr>
                        )}
                        {receipts.map((r) => (
                            <tr key={r.id} className="border-b border-slate-100 align-top">
                                <td className="whitespace-nowrap px-3 py-2">{formatDate(r.date)}</td>
                                <td className="px-3 py-2">
                                    <span className={r.direction === 'RECEIPT' ? 'text-green-700' : 'text-orange-700'}>{r.direction === 'RECEIPT' ? 'Receipt' : 'Payment'}</span>
                                    <span className="block text-xs text-slate-400">{r.voucher_number}</span>
                                </td>
                                <td className="px-3 py-2">{r.party_name}</td>
                                <td className="px-3 py-2">
                                    {r.deposit_ledger_name}
                                    <span className="block text-xs text-slate-400">{[r.payment_mode, r.reference_number].filter(Boolean).join(' · ')}</span>
                                </td>
                                <td className="px-3 py-2 text-xs text-slate-600">
                                    {r.allocations.map((a) => `${a.invoice_number} (${inr(a.amount)})`).join(', ') || '—'}
                                </td>
                                <td className="px-3 py-2 text-right font-medium">{inr(r.amount)}</td>
                                <td className="px-3 py-2 text-right">{r.unallocated > 0 ? <span className="text-amber-700">{inr(r.unallocated)}</span> : '—'}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right">
                                    {canWrite && r.unallocated > 0 && (
                                        <button onClick={() => startAllocate(r)} className="p-1 text-slate-400 hover:text-primary" title="Adjust advance against bills">
                                            <Link2 className="h-4 w-4" />
                                        </button>
                                    )}
                                    {canWrite && (
                                        <button onClick={() => remove(r)} className="p-1 text-slate-400 hover:text-red-600" title="Delete">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {allocating && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setAllocating(null)}>
                    <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                        <h2 className="mb-1 text-lg font-semibold text-slate-800">Adjust advance from {allocating.party_name}</h2>
                        <p className="mb-4 text-sm text-slate-500">{inr(allocating.unallocated)} available from {allocating.voucher_number}</p>
                        <AllocationTable invoices={openInv} alloc={alloc} setAlloc={setAlloc} available={allocating.unallocated} />
                        <div className="mt-4 flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => setAllocating(null)}>Cancel</Button>
                            <Button onClick={saveAllocation} isLoading={saving} disabled={!allocationsFrom(alloc).length}>Adjust</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
