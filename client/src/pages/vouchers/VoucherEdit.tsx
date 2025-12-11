import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Plus, Trash2, Save } from 'lucide-react';
import api from '../../api/axios';

interface VoucherType {
    id: string;
    name: string;
}

interface Ledger {
    id: string;
    name: string;
}

interface Entry {
    ledgerId: string;
    ledgerName?: string;
    amount: number;
    type: 'Dr' | 'Cr';
}

export const VoucherEdit: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [voucherTypes, setVoucherTypes] = useState<VoucherType[]>([]);
    const [ledgers, setLedgers] = useState<Ledger[]>([]);

    const [formData, setFormData] = useState({
        voucherTypeId: '',
        voucherNumber: '',
        date: new Date().toISOString().split('T')[0],
        narration: ''
    });

    const [entries, setEntries] = useState<Entry[]>([
        { ledgerId: '', amount: 0, type: 'Dr' as const },
        { ledgerId: '', amount: 0, type: 'Cr' as const }
    ]);

    useEffect(() => {
        const fetchData = async () => {
            if (!selectedCompany || !id) return;

            try {
                // Fetch voucher types
                const typesRes = await api.get(`/vouchers/types?companyId=${selectedCompany.id}`);
                setVoucherTypes(typesRes.data.data.voucherTypes);

                // Fetch ledgers
                const ledgersRes = await api.get(`/ledgers?companyId=${selectedCompany.id}`);
                setLedgers(ledgersRes.data.data.ledgers);

                // Fetch existing voucher
                const voucherRes = await api.get(`/vouchers/${id}`);
                const voucher = voucherRes.data.data.voucher;
                const voucherEntries = voucherRes.data.data.entries;

                setFormData({
                    voucherTypeId: voucher.voucher_type_id,
                    voucherNumber: voucher.voucher_number,
                    date: voucher.date.split('T')[0],
                    narration: voucher.narration || ''
                });

                setEntries(voucherEntries.map((e: any) => ({
                    ledgerId: e.ledger_id,
                    ledgerName: e.ledger_name,
                    amount: parseFloat(e.amount),
                    type: e.type
                })));
            } catch (error) {
                console.error('Failed to fetch data', error);
                alert('Failed to load voucher');
                navigate('/vouchers');
            }
        };

        fetchData();
    }, [selectedCompany, id]);

    const addEntry = () => {
        setEntries([...entries, { ledgerId: '', amount: 0, type: 'Dr' }]);
    };

    const removeEntry = (index: number) => {
        if (entries.length > 2) {
            setEntries(entries.filter((_, i) => i !== index));
        }
    };

    const updateEntry = (index: number, field: keyof Entry, value: any) => {
        const updated = [...entries];
        updated[index] = { ...updated[index], [field]: value };
        setEntries(updated);
    };

    const calculateTotals = () => {
        const debit = entries.filter(e => e.type === 'Dr').reduce((sum, e) => sum + Number(e.amount), 0);
        const credit = entries.filter(e => e.type === 'Cr').reduce((sum, e) => sum + Number(e.amount), 0);
        return { debit, credit, difference: Math.abs(debit - credit) };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany || !id) return;

        const { debit, credit, difference } = calculateTotals();
        if (difference > 0.01) {
            alert(`Voucher is not balanced. Debit: ₹${debit}, Credit: ₹${credit}`);
            return;
        }

        setLoading(true);
        try {
            await api.put(`/vouchers/${id}`, {
                voucherTypeId: formData.voucherTypeId,
                voucherNumber: formData.voucherNumber,
                date: formData.date,
                narration: formData.narration,
                entries: entries.map(e => ({
                    ledgerId: e.ledgerId,
                    amount: e.amount,
                    type: e.type
                }))
            });
            navigate('/vouchers');
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to update voucher');
        } finally {
            setLoading(false);
        }
    };

    const totals = calculateTotals();

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Edit Voucher</h1>
                <Button variant="secondary" onClick={() => navigate('/vouchers')}>
                    Cancel
                </Button>
            </div>

            <form onSubmit={handleSubmit} className="card">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Voucher Type</label>
                        <select
                            className="input-field"
                            value={formData.voucherTypeId}
                            onChange={(e) => setFormData({ ...formData, voucherTypeId: e.target.value })}
                            required
                        >
                            <option value="">Select Type</option>
                            {voucherTypes.map(type => (
                                <option key={type.id} value={type.id}>{type.name}</option>
                            ))}
                        </select>
                    </div>

                    <Input
                        label="Voucher Number"
                        value={formData.voucherNumber}
                        onChange={(e) => setFormData({ ...formData, voucherNumber: e.target.value })}
                        required
                    />

                    <Input
                        label="Date"
                        type="date"
                        value={formData.date}
                        onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                        required
                    />

                    <Input
                        label="Narration"
                        value={formData.narration}
                        onChange={(e) => setFormData({ ...formData, narration: e.target.value })}
                    />
                </div>

                <div className="mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-slate-800">Entries</h3>
                        <Button type="button" variant="secondary" onClick={addEntry}>
                            <Plus className="w-4 h-4" />
                            Add Entry
                        </Button>
                    </div>

                    <div className="space-y-3">
                        {entries.map((entry, index) => (
                            <div key={index} className="grid grid-cols-12 gap-3 items-end">
                                <div className="col-span-5">
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Ledger</label>
                                    <select
                                        className="input-field"
                                        value={entry.ledgerId}
                                        onChange={(e) => updateEntry(index, 'ledgerId', e.target.value)}
                                        required
                                    >
                                        <option value="">Select Ledger</option>
                                        {ledgers.map(ledger => (
                                            <option key={ledger.id} value={ledger.id}>{ledger.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="col-span-3">
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Amount</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="input-field"
                                        value={entry.amount}
                                        onChange={(e) => updateEntry(index, 'amount', parseFloat(e.target.value) || 0)}
                                        required
                                    />
                                </div>

                                <div className="col-span-3">
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Type</label>
                                    <select
                                        className="input-field"
                                        value={entry.type}
                                        onChange={(e) => updateEntry(index, 'type', e.target.value)}
                                        required
                                    >
                                        <option value="Dr">Debit</option>
                                        <option value="Cr">Credit</option>
                                    </select>
                                </div>

                                <div className="col-span-1">
                                    <button
                                        type="button"
                                        onClick={() => removeEntry(index)}
                                        className="p-2 text-red-500 hover:bg-red-50 rounded transition-colors"
                                        disabled={entries.length <= 2}
                                    >
                                        <Trash2 className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-lg mb-6">
                    <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                            <p className="text-sm text-slate-500">Total Debit</p>
                            <p className="text-lg font-bold text-slate-800">₹{totals.debit.toFixed(2)}</p>
                        </div>
                        <div>
                            <p className="text-sm text-slate-500">Total Credit</p>
                            <p className="text-lg font-bold text-slate-800">₹{totals.credit.toFixed(2)}</p>
                        </div>
                        <div>
                            <p className="text-sm text-slate-500">Difference</p>
                            <p className={`text-lg font-bold ${totals.difference < 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>
                                ₹{totals.difference.toFixed(2)}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3">
                    <Button type="button" variant="secondary" onClick={() => navigate('/vouchers')}>
                        Cancel
                    </Button>
                    <Button type="submit" isLoading={loading} disabled={totals.difference > 0.01}>
                        <Save className="w-4 h-4" />
                        Update Voucher
                    </Button>
                </div>
            </form>
        </div>
    );
};
