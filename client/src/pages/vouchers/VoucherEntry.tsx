import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Plus, Trash2, Save, ArrowLeft } from 'lucide-react';
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
    amount: number;
    type: 'Dr' | 'Cr';
}

export const VoucherEntry: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [voucherTypes, setVoucherTypes] = useState<VoucherType[]>([]);
    const [ledgers, setLedgers] = useState<Ledger[]>([]);

    const [formData, setFormData] = useState({
        voucherTypeId: '',
        voucherNumber: '',
        date: new Date().toISOString().split('T')[0],
        narration: '',
    });

    const [entries, setEntries] = useState<Entry[]>([
        { ledgerId: '', amount: 0, type: 'Dr' },
        { ledgerId: '', amount: 0, type: 'Cr' }
    ]);

    useEffect(() => {
        const fetchData = async () => {
            if (!selectedCompany) return;
            try {
                const [vTypesRes, ledgersRes] = await Promise.all([
                    api.get(`/vouchers/types?companyId=${selectedCompany.id}`),
                    api.get(`/ledgers?companyId=${selectedCompany.id}`)
                ]);
                setVoucherTypes(vTypesRes.data.data.voucherTypes);
                setLedgers(ledgersRes.data.data.ledgers);

                if (vTypesRes.data.data.voucherTypes.length > 0) {
                    setFormData(prev => ({ ...prev, voucherTypeId: vTypesRes.data.data.voucherTypes[0].id }));
                }
            } catch (error) {
                console.error('Failed to fetch data', error);
            }
        };
        fetchData();
    }, [selectedCompany]);

    const handleEntryChange = (index: number, field: keyof Entry, value: any) => {
        const newEntries = [...entries];
        newEntries[index] = { ...newEntries[index], [field]: value };
        setEntries(newEntries);
    };

    const addEntry = () => {
        setEntries([...entries, { ledgerId: '', amount: 0, type: 'Dr' }]);
    };

    const removeEntry = (index: number) => {
        if (entries.length <= 2) return;
        const newEntries = entries.filter((_, i) => i !== index);
        setEntries(newEntries);
    };

    const totalDebit = entries
        .filter(e => e.type === 'Dr')
        .reduce((sum, e) => sum + Number(e.amount), 0);

    const totalCredit = entries
        .filter(e => e.type === 'Cr')
        .reduce((sum, e) => sum + Number(e.amount), 0);

    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isBalanced) {
            alert('Voucher is not balanced!');
            return;
        }

        setLoading(true);
        try {
            await api.post('/vouchers', {
                ...formData,
                companyId: selectedCompany?.id,
                entries
            });
            navigate('/vouchers');
        } catch (error) {
            console.error('Failed to create voucher', error);
            alert('Failed to save voucher');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="secondary" onClick={() => navigate('/vouchers')}>
                        <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <h1 className="text-2xl font-bold text-slate-800">New Voucher</h1>
                </div>
                <Button onClick={handleSubmit} isLoading={loading} disabled={!isBalanced}>
                    <Save className="w-4 h-4" />
                    Save Voucher
                </Button>
            </div>

            <div className="card">
                {/* Header Fields */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Voucher Type</label>
                        <select
                            className="input-field"
                            value={formData.voucherTypeId}
                            onChange={(e) => setFormData({ ...formData, voucherTypeId: e.target.value })}
                        >
                            {voucherTypes.map(vt => (
                                <option key={vt.id} value={vt.id}>{vt.name}</option>
                            ))}
                        </select>
                    </div>
                    <Input
                        label="Voucher No"
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
                </div>

                {/* Entries Table */}
                <div className="border rounded-lg overflow-hidden mb-6">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="py-3 px-4 font-semibold text-slate-600 w-24">Type</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Ledger Account</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 w-48 text-right">Debit</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 w-48 text-right">Credit</th>
                                <th className="py-3 px-4 w-12"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {entries.map((entry, index) => (
                                <tr key={index}>
                                    <td className="p-2">
                                        <select
                                            className="input-field py-1"
                                            value={entry.type}
                                            onChange={(e) => handleEntryChange(index, 'type', e.target.value)}
                                        >
                                            <option value="Dr">Dr</option>
                                            <option value="Cr">Cr</option>
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <select
                                            className="input-field py-1"
                                            value={entry.ledgerId}
                                            onChange={(e) => handleEntryChange(index, 'ledgerId', e.target.value)}
                                        >
                                            <option value="">Select Ledger</option>
                                            {ledgers.map(l => (
                                                <option key={l.id} value={l.id}>{l.name}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <input
                                            type="number"
                                            className="input-field py-1 text-right"
                                            value={entry.type === 'Dr' ? entry.amount : ''}
                                            onChange={(e) => {
                                                if (entry.type === 'Dr') handleEntryChange(index, 'amount', Number(e.target.value));
                                            }}
                                            disabled={entry.type !== 'Dr'}
                                        />
                                    </td>
                                    <td className="p-2">
                                        <input
                                            type="number"
                                            className="input-field py-1 text-right"
                                            value={entry.type === 'Cr' ? entry.amount : ''}
                                            onChange={(e) => {
                                                if (entry.type === 'Cr') handleEntryChange(index, 'amount', Number(e.target.value));
                                            }}
                                            disabled={entry.type !== 'Cr'}
                                        />
                                    </td>
                                    <td className="p-2 text-center">
                                        <button
                                            onClick={() => removeEntry(index)}
                                            className="text-slate-400 hover:text-red-500 transition-colors"
                                            disabled={entries.length <= 2}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-slate-50 border-t border-slate-200 font-bold">
                            <tr>
                                <td colSpan={2} className="py-3 px-4 text-right text-slate-600">Total:</td>
                                <td className="py-3 px-4 text-right text-slate-800">₹{totalDebit.toLocaleString()}</td>
                                <td className="py-3 px-4 text-right text-slate-800">₹{totalCredit.toLocaleString()}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div className="flex items-center justify-between mb-6">
                    <Button variant="secondary" onClick={addEntry} type="button">
                        <Plus className="w-4 h-4" />
                        Add Line
                    </Button>

                    <div className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold ${isBalanced ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {isBalanced ? (
                            <>Balanced ✅</>
                        ) : (
                            <>Difference: ₹{Math.abs(totalDebit - totalCredit).toLocaleString()} ⚠️</>
                        )}
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Narration</label>
                    <textarea
                        className="input-field min-h-[80px]"
                        value={formData.narration}
                        onChange={(e) => setFormData({ ...formData, narration: e.target.value })}
                        placeholder="Enter narration for this voucher..."
                    />
                </div>
            </div>
        </div>
    );
};
