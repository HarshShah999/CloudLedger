import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { FileSpreadsheet, Filter, TrendingUp, TrendingDown } from 'lucide-react';
import api from '../../api/axios';

interface LedgerItem {
    group_name: string;
    group_type: string;
    ledger_name: string;
    balance: number;
    balance_type: string;
}

export const ProfitAndLoss: React.FC = () => {
    const { selectedCompany } = useCompany();
    const [loading, setLoading] = useState(false);
    const [income, setIncome] = useState<LedgerItem[]>([]);
    const [expenses, setExpenses] = useState<LedgerItem[]>([]);
    const [totalIncome, setTotalIncome] = useState(0);
    const [totalExpenses, setTotalExpenses] = useState(0);
    const [netProfit, setNetProfit] = useState(0);
    const [netProfitType, setNetProfitType] = useState('Profit');

    const [startDate, setStartDate] = useState('2024-04-01');
    const [endDate, setEndDate] = useState('2025-03-31');

    const fetchReport = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const response = await api.get('/reports/pnl', {
                params: {
                    companyId: selectedCompany.id,
                    startDate,
                    endDate
                }
            });
            const data = response.data.data;
            setIncome(data.income);
            setExpenses(data.expenses);
            setTotalIncome(data.totalIncome);
            setTotalExpenses(data.totalExpenses);
            setNetProfit(data.netProfit);
            setNetProfitType(data.netProfitType);
        } catch (error) {
            console.error('Failed to fetch P&L', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReport();
    }, [selectedCompany]);

    const handleExportExcel = async () => {
        if (!selectedCompany) return;
        try {
            const response = await api.get('/export/pnl/excel', {
                params: {
                    companyId: selectedCompany.id,
                    startDate,
                    endDate
                },
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'profit-loss.xlsx');
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            console.error('Export failed', error);
            alert('Failed to export report');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Profit & Loss Statement</h1>
                <Button variant="secondary" onClick={handleExportExcel}>
                    <FileSpreadsheet className="w-4 h-4" />
                    Export Excel
                </Button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card">
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-slate-500">Total Income</p>
                        <TrendingUp className="w-5 h-5 text-emerald-500" />
                    </div>
                    <p className="text-2xl font-bold text-emerald-600">
                        ₹{totalIncome.toLocaleString()}
                    </p>
                </div>

                <div className="card">
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-slate-500">Total Expenses</p>
                        <TrendingDown className="w-5 h-5 text-red-500" />
                    </div>
                    <p className="text-2xl font-bold text-red-600">
                        ₹{totalExpenses.toLocaleString()}
                    </p>
                </div>

                <div className="card">
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-slate-500">Net {netProfitType}</p>
                        {netProfit >= 0 ? (
                            <TrendingUp className="w-5 h-5 text-emerald-500" />
                        ) : (
                            <TrendingDown className="w-5 h-5 text-red-500" />
                        )}
                    </div>
                    <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        ₹{Math.abs(netProfit).toLocaleString()}
                    </p>
                </div>
            </div>

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
                    <Button onClick={fetchReport} isLoading={loading}>
                        <Filter className="w-4 h-4" />
                        Apply Filter
                    </Button>
                </div>

                {/* Report Table */}
                <div className="mt-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Income Section */}
                        <div>
                            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-emerald-500" />
                                Income
                            </h3>
                            <div className="space-y-2">
                                {income.length === 0 ? (
                                    <p className="text-slate-500 text-sm">No income records</p>
                                ) : (
                                    income.map((item, idx) => (
                                        <div key={idx} className="flex justify-between items-center py-2 border-b border-slate-100">
                                            <span className="text-slate-700">{item.ledger_name}</span>
                                            <span className="font-mono text-emerald-600">
                                                ₹{item.balance.toLocaleString()}
                                            </span>
                                        </div>
                                    ))
                                )}
                                <div className="flex justify-between items-center py-3 border-t-2 border-slate-300 font-bold">
                                    <span className="text-slate-800">Total Income</span>
                                    <span className="font-mono text-emerald-600">
                                        ₹{totalIncome.toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Expenses Section */}
                        <div>
                            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <TrendingDown className="w-5 h-5 text-red-500" />
                                Expenses
                            </h3>
                            <div className="space-y-2">
                                {expenses.length === 0 ? (
                                    <p className="text-slate-500 text-sm">No expense records</p>
                                ) : (
                                    expenses.map((item, idx) => (
                                        <div key={idx} className="flex justify-between items-center py-2 border-b border-slate-100">
                                            <span className="text-slate-700">{item.ledger_name}</span>
                                            <span className="font-mono text-red-600">
                                                ₹{item.balance.toLocaleString()}
                                            </span>
                                        </div>
                                    ))
                                )}
                                <div className="flex justify-between items-center py-3 border-t-2 border-slate-300 font-bold">
                                    <span className="text-slate-800">Total Expenses</span>
                                    <span className="font-mono text-red-600">
                                        ₹{totalExpenses.toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Net Profit/Loss */}
                    <div className="mt-8 p-6 bg-slate-50 rounded-lg">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xl font-bold text-slate-800">Net {netProfitType}</h3>
                            <p className={`text-3xl font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                ₹{Math.abs(netProfit).toLocaleString()}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
