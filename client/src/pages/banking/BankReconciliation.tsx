
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import api from '../../api/axios';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { format } from 'date-fns';

interface Transaction {
    id: string;
    amount: string;
    type: 'Dr' | 'Cr';
    instrument_number: string;
    instrument_date: string;
    bank_allocation_date: string | null;
    voucher_date: string;
    voucher_number: string;
    narration: string;
    voucher_type: string;
}

interface Ledger {
    id: string;
    name: string;
}

export const BankReconciliation: React.FC = () => {
    const { selectedCompany } = useCompany();
    const [ledgers, setLedgers] = useState<Ledger[]>([]);
    const [selectedLedgerId, setSelectedLedgerId] = useState<string>('');
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState<string | null>(null);

    // Date Range
    const [fromDate, setFromDate] = useState(format(new Date().setDate(1), 'yyyy-MM-dd'));
    const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));

    useEffect(() => {
        if (selectedCompany) {
            fetchBankLedgers();
        }
    }, [selectedCompany]);

    const fetchBankLedgers = async () => {
        try {
            // Assuming we have an endpoint or filter for bank ledgers. 
            // For now fetching all and filtering client side or if backend supports group filtering
            const response = await api.get('/ledgers');
            // Optimistically filtering for "Bank" or just showing all for selection
            // In a real scenario, should filter by group 'Bank Accounts'
            const bankLedgers = response.data.data.ledgers.filter((l: any) =>
                l.group_name === 'Bank Accounts' || l.name.toLowerCase().includes('bank')
            );
            setLedgers(bankLedgers);
        } catch (error) {
            console.error('Failed to fetch ledgers', error);
        }
    };

    const fetchTransactions = async () => {
        if (!selectedLedgerId) return;
        setLoading(true);
        try {
            const response = await api.get(`/reconciliation/ledger/${selectedLedgerId}`, {
                params: { fromDate, toDate }
            });
            setTransactions(response.data.data.transactions);
        } catch (error) {
            console.error('Failed to fetch transactions', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDateChange = async (id: string, date: string) => {
        setSaving(id);
        try {
            await api.patch(`/reconciliation/transaction/${id}`, {
                bankAllocationDate: date || null
            });

            // Update local state
            setTransactions(prev => prev.map(t =>
                t.id === id ? { ...t, bank_allocation_date: date || null } : t
            ));
        } catch (error) {
            console.error('Failed to update reconciliation date', error);
        } finally {
            setSaving(null);
        }
    };

    const calculateTotals = () => {
        const companyBalance = transactions.reduce((acc, t) => {
            return acc + (t.type === 'Dr' ? Number(t.amount) : -Number(t.amount));
        }, 0);

        const amountsNotReflected = transactions.reduce((acc, t) => {
            if (!t.bank_allocation_date) {
                return acc + (t.type === 'Dr' ? Number(t.amount) : -Number(t.amount));
            }
            return acc;
        }, 0);

        return {
            companyBalance,
            amountsNotReflected,
            bankBalance: companyBalance - amountsNotReflected
        };
    };

    const totals = calculateTotals();

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-slate-800">Bank Reconciliation</h1>
            </div>

            <Card className="p-4">
                <div className="flex gap-4 items-end">
                    <div className="w-64">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Bank Ledger</label>
                        <select
                            className="w-full rounded-lg border-slate-300 focus:border-primary focus:ring-primary"
                            value={selectedLedgerId}
                            onChange={(e) => setSelectedLedgerId(e.target.value)}
                        >
                            <option value="">Select Bank Ledger</option>
                            {ledgers.map(l => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <Input
                            label="From"
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                        />
                    </div>
                    <div>
                        <Input
                            label="To"
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                        />
                    </div>
                    <Button onClick={fetchTransactions} disabled={!selectedLedgerId || loading}>
                        {loading ? 'Loading...' : 'Show Transactions'}
                    </Button>
                </div>
            </Card>

            {selectedLedgerId && (
                <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Particulars</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Vch Type</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Vch No</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Instrument Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Debit</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Credit</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Bank Date</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-200">
                                {transactions.map((t) => (
                                    <tr key={t.id} className="hover:bg-slate-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                                            {format(new Date(t.voucher_date), 'dd-MM-yyyy')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">{t.narration || '-'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">{t.voucher_type}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">{t.voucher_number}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                                            {t.instrument_date ? format(new Date(t.instrument_date), 'dd-MM-yyyy') : '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 font-medium">
                                            {t.type === 'Dr' ? Number(t.amount).toFixed(2) : ''}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 font-medium">
                                            {t.type === 'Cr' ? Number(t.amount).toFixed(2) : ''}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            <input
                                                type="date"
                                                className="rounded border-slate-300 text-sm focus:ring-primary focus:border-primary"
                                                value={t.bank_allocation_date ? format(new Date(t.bank_allocation_date), 'yyyy-MM-dd') : ''}
                                                onChange={(e) => handleDateChange(t.id, e.target.value)}
                                            />
                                            {saving === t.id && <span className="ml-2 text-xs text-primary">Saving...</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="bg-slate-50 p-4 border-t border-slate-200">
                        <div className="grid grid-cols-3 gap-4 text-sm">
                            <div className="p-3 bg-white rounded-lg shadow-sm">
                                <p className="text-slate-500 mb-1">Balance as per Company Books</p>
                                <p className="text-lg font-bold text-slate-800">
                                    {Math.abs(totals.companyBalance).toFixed(2)} {totals.companyBalance >= 0 ? 'Dr' : 'Cr'}
                                </p>
                            </div>
                            <div className="p-3 bg-white rounded-lg shadow-sm">
                                <p className="text-slate-500 mb-1">Amounts not reflected in Bank</p>
                                <p className="text-lg font-bold text-orange-600">
                                    {Math.abs(totals.amountsNotReflected).toFixed(2)} {totals.amountsNotReflected >= 0 ? 'Dr' : 'Cr'}
                                </p>
                            </div>
                            <div className="p-3 bg-white rounded-lg shadow-sm">
                                <p className="text-slate-500 mb-1">Balance as per Bank</p>
                                <p className="text-lg font-bold text-green-600">
                                    {Math.abs(totals.bankBalance).toFixed(2)} {totals.bankBalance >= 0 ? 'Dr' : 'Cr'}
                                </p>
                            </div>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
};
