import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ArrowLeft, Download, Filter, TrendingUp, TrendingDown } from 'lucide-react';
import api from '../../api/axios';

interface Transaction {
    id: string;
    date: string;
    voucher_number: string;
    voucher_type_name: string;
    narration: string;
    debit: number;
    credit: number;
    balance: number;
    balance_type: string;
}

interface LedgerInfo {
    id: string;
    name: string;
    group_name: string;
    group_type: string;
    opening_balance: number;
    opening_balance_type: string;
    closing_balance: number;
    closing_balance_type: string;
}

export const LedgerStatement: React.FC = () => {
    const { ledgerId } = useParams<{ ledgerId: string }>();
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();

    const [ledger, setLedger] = useState<LedgerInfo | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(false);
    const [startDate, setStartDate] = useState('2024-04-01');
    const [endDate, setEndDate] = useState('2025-03-31');

    const fetchStatement = async () => {
        if (!selectedCompany || !ledgerId) return;
        setLoading(true);
        try {
            const response = await api.get(`/ledgers/${ledgerId}/statement`, {
                params: {
                    companyId: selectedCompany.id,
                    startDate,
                    endDate
                }
            });
            setLedger(response.data.data.ledger);
            setTransactions(response.data.data.transactions);
        } catch (error) {
            console.error('Failed to fetch ledger statement', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatement();
    }, [selectedCompany, ledgerId]);

    const totalDebit = transactions.reduce((sum, t) => sum + Number(t.debit), 0);
    const totalCredit = transactions.reduce((sum, t) => sum + Number(t.credit), 0);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="secondary" onClick={() => navigate('/ledgers')}>
                        <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">{ledger?.name || 'Ledger Statement'}</h1>
                        <p className="text-sm text-slate-500">{ledger?.group_name} ({ledger?.group_type})</p>
                    </div>
                </div>
                <Button variant="secondary" onClick={() => window.print()}>
                    <Download className="w-4 h-4" />
                    Export
                </Button>
            </div>

            {/* Summary Cards */}
            {ledger && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="card">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-slate-500">Opening Balance</p>
                            <TrendingUp className="w-5 h-5 text-blue-500" />
                        </div>
                        <p className="text-2xl font-bold text-slate-800">
                            ₹{Number(ledger.opening_balance).toLocaleString()}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">{ledger.opening_balance_type}</p>
                    </div>

                    <div className="card">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-slate-500">Total Transactions</p>
                            <TrendingDown className="w-5 h-5 text-purple-500" />
                        </div>
                        <p className="text-2xl font-bold text-slate-800">{transactions.length}</p>
                        <p className="text-xs text-slate-500 mt-1">
                            Dr: ₹{totalDebit.toLocaleString()} | Cr: ₹{totalCredit.toLocaleString()}
                        </p>
                    </div>

                    <div className="card">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-slate-500">Closing Balance</p>
                            <TrendingUp className="w-5 h-5 text-emerald-500" />
                        </div>
                        <p className="text-2xl font-bold text-slate-800">
                            ₹{Math.abs(Number(ledger.closing_balance)).toLocaleString()}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">{ledger.closing_balance_type}</p>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="card">
                <div className="flex items-end gap-4 p-4 bg-slate-50 rounded-lg">
                    <div className="w-48">
                        <Input
                            label="Start Date"
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                        />
                    </div>
                    <div className="w-48">
                        <Input
                            label="End Date"
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                        />
                    </div>
                    <Button onClick={fetchStatement} isLoading={loading}>
                        <Filter className="w-4 h-4" />
                        Apply Filter
                    </Button>
                </div>

                {/* Transactions Table */}
                <div className="overflow-x-auto mt-6">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b-2 border-slate-200 bg-slate-50">
                                <th className="py-3 px-4 font-bold text-slate-700">Date</th>
                                <th className="py-3 px-4 font-bold text-slate-700">Voucher No.</th>
                                <th className="py-3 px-4 font-bold text-slate-700">Type</th>
                                <th className="py-3 px-4 font-bold text-slate-700">Particulars</th>
                                <th className="py-3 px-4 font-bold text-slate-700 text-right">Debit</th>
                                <th className="py-3 px-4 font-bold text-slate-700 text-right">Credit</th>
                                <th className="py-3 px-4 font-bold text-slate-700 text-right">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* Opening Balance Row */}
                            {ledger && (
                                <tr className="border-b border-slate-100 bg-blue-50">
                                    <td className="py-2 px-4 font-medium text-slate-600" colSpan={4}>
                                        Opening Balance
                                    </td>
                                    <td className="py-2 px-4 text-right font-mono text-slate-700">
                                        {ledger.opening_balance_type === 'Dr' ? Number(ledger.opening_balance).toLocaleString() : '-'}
                                    </td>
                                    <td className="py-2 px-4 text-right font-mono text-slate-700">
                                        {ledger.opening_balance_type === 'Cr' ? Number(ledger.opening_balance).toLocaleString() : '-'}
                                    </td>
                                    <td className="py-2 px-4 text-right font-bold text-slate-800">
                                        ₹{Number(ledger.opening_balance).toLocaleString()} {ledger.opening_balance_type}
                                    </td>
                                </tr>
                            )}

                            {loading ? (
                                <tr><td colSpan={7} className="text-center py-8">Loading...</td></tr>
                            ) : transactions.length === 0 ? (
                                <tr><td colSpan={7} className="text-center py-8 text-slate-500">No transactions found</td></tr>
                            ) : (
                                transactions.map((txn) => (
                                    <tr key={txn.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="py-2 px-4 text-slate-600">
                                            {new Date(txn.date).toLocaleDateString()}
                                        </td>
                                        <td className="py-2 px-4 font-medium text-slate-800">{txn.voucher_number}</td>
                                        <td className="py-2 px-4">
                                            <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded text-xs font-medium">
                                                {txn.voucher_type_name}
                                            </span>
                                        </td>
                                        <td className="py-2 px-4 text-slate-600 max-w-xs truncate">{txn.narration}</td>
                                        <td className="py-2 px-4 text-right font-mono text-slate-700">
                                            {txn.debit > 0 ? Number(txn.debit).toLocaleString() : '-'}
                                        </td>
                                        <td className="py-2 px-4 text-right font-mono text-slate-700">
                                            {txn.credit > 0 ? Number(txn.credit).toLocaleString() : '-'}
                                        </td>
                                        <td className="py-2 px-4 text-right font-bold text-slate-800">
                                            ₹{Math.abs(Number(txn.balance)).toLocaleString()} {txn.balance_type}
                                        </td>
                                    </tr>
                                ))
                            )}

                            {/* Closing Balance Row */}
                            {ledger && transactions.length > 0 && (
                                <tr className="border-t-2 border-slate-300 bg-emerald-50 font-bold">
                                    <td colSpan={4} className="py-3 px-4 text-right text-slate-800">
                                        Closing Balance:
                                    </td>
                                    <td className="py-3 px-4 text-right text-slate-900">
                                        ₹{totalDebit.toLocaleString()}
                                    </td>
                                    <td className="py-3 px-4 text-right text-slate-900">
                                        ₹{totalCredit.toLocaleString()}
                                    </td>
                                    <td className="py-3 px-4 text-right text-slate-900">
                                        ₹{Math.abs(Number(ledger.closing_balance)).toLocaleString()} {ledger.closing_balance_type}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
