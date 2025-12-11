import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { FileSpreadsheet, Filter, Building2, CreditCard } from 'lucide-react';
import api from '../../api/axios';

interface LedgerItem {
    group_name: string;
    group_type: string;
    ledger_name: string;
    balance: number;
    balance_type: string;
}

export const BalanceSheet: React.FC = () => {
    const { selectedCompany } = useCompany();
    const [loading, setLoading] = useState(false);
    const [assets, setAssets] = useState<LedgerItem[]>([]);
    const [liabilities, setLiabilities] = useState<LedgerItem[]>([]);
    const [totalAssets, setTotalAssets] = useState(0);
    const [totalLiabilities, setTotalLiabilities] = useState(0);
    const [difference, setDifference] = useState(0);

    const [asOfDate, setAsOfDate] = useState('2025-03-31');

    const fetchReport = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const response = await api.get('/reports/balance-sheet', {
                params: {
                    companyId: selectedCompany.id,
                    asOfDate
                }
            });
            const data = response.data.data;
            setAssets(data.assets);
            setLiabilities(data.liabilities);
            setTotalAssets(data.totalAssets);
            setTotalLiabilities(data.totalLiabilities);
            setDifference(data.difference);
        } catch (error) {
            console.error('Failed to fetch Balance Sheet', error);
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
            const response = await api.get('/export/balance-sheet/excel', {
                params: {
                    companyId: selectedCompany.id,
                    asOfDate
                },
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'balance-sheet.xlsx');
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
                <h1 className="text-2xl font-bold text-slate-800">Balance Sheet</h1>
                <Button variant="secondary" onClick={handleExportExcel}>
                    <FileSpreadsheet className="w-4 h-4" />
                    Export Excel
                </Button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card">
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-slate-500">Total Assets</p>
                        <Building2 className="w-5 h-5 text-blue-500" />
                    </div>
                    <p className="text-2xl font-bold text-blue-600">
                        ₹{totalAssets.toLocaleString()}
                    </p>
                </div>

                <div className="card">
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-slate-500">Total Liabilities</p>
                        <CreditCard className="w-5 h-5 text-purple-500" />
                    </div>
                    <p className="text-2xl font-bold text-purple-600">
                        ₹{totalLiabilities.toLocaleString()}
                    </p>
                </div>

                <div className="card">
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-slate-500">Net Worth</p>
                        <Building2 className="w-5 h-5 text-emerald-500" />
                    </div>
                    <p className={`text-2xl font-bold ${difference >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        ₹{Math.abs(difference).toLocaleString()}
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="card">
                <div className="flex items-end gap-4 p-4 bg-slate-50 rounded-lg">
                    <div className="w-64">
                        <Input
                            label="As of Date"
                            type="date"
                            value={asOfDate}
                            onChange={(e) => setAsOfDate(e.target.value)}
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
                        {/* Assets Section */}
                        <div>
                            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <Building2 className="w-5 h-5 text-blue-500" />
                                Assets
                            </h3>
                            <div className="space-y-2">
                                {assets.length === 0 ? (
                                    <p className="text-slate-500 text-sm">No asset records</p>
                                ) : (
                                    assets.map((item, idx) => (
                                        <div key={idx} className="flex justify-between items-center py-2 border-b border-slate-100">
                                            <span className="text-slate-700">{item.ledger_name}</span>
                                            <span className="font-mono text-blue-600">
                                                ₹{item.balance.toLocaleString()}
                                            </span>
                                        </div>
                                    ))
                                )}
                                <div className="flex justify-between items-center py-3 border-t-2 border-slate-300 font-bold">
                                    <span className="text-slate-800">Total Assets</span>
                                    <span className="font-mono text-blue-600">
                                        ₹{totalAssets.toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Liabilities Section */}
                        <div>
                            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <CreditCard className="w-5 h-5 text-purple-500" />
                                Liabilities
                            </h3>
                            <div className="space-y-2">
                                {liabilities.length === 0 ? (
                                    <p className="text-slate-500 text-sm">No liability records</p>
                                ) : (
                                    liabilities.map((item, idx) => (
                                        <div key={idx} className="flex justify-between items-center py-2 border-b border-slate-100">
                                            <span className="text-slate-700">{item.ledger_name}</span>
                                            <span className="font-mono text-purple-600">
                                                ₹{item.balance.toLocaleString()}
                                            </span>
                                        </div>
                                    ))
                                )}
                                <div className="flex justify-between items-center py-3 border-t-2 border-slate-300 font-bold">
                                    <span className="text-slate-800">Total Liabilities</span>
                                    <span className="font-mono text-purple-600">
                                        ₹{totalLiabilities.toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Net Worth */}
                    <div className="mt-8 p-6 bg-slate-50 rounded-lg">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xl font-bold text-slate-800">Net Worth (Assets - Liabilities)</h3>
                            <p className={`text-3xl font-bold ${difference >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                ₹{Math.abs(difference).toLocaleString()}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
