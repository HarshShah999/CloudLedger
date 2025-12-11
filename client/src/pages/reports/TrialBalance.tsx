import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Download, Filter, FileSpreadsheet } from 'lucide-react';
import api from '../../api/axios';

interface ReportRow {
    id: string;
    name: string;
    group_name: string;
    group_type: string;
    closing_balance: number;
    closing_balance_type: string;
}

export const TrialBalance: React.FC = () => {
    const { selectedCompany } = useCompany();
    const [reportData, setReportData] = useState<ReportRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [startDate, setStartDate] = useState('2024-04-01');
    const [endDate, setEndDate] = useState('2025-03-31');

    const fetchReport = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const response = await api.get(`/reports/trial-balance`, {
                params: {
                    companyId: selectedCompany.id,
                    startDate,
                    endDate
                }
            });
            setReportData(response.data.data.report);
        } catch (error) {
            console.error('Failed to fetch report', error);
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
            const response = await api.get('/export/trial-balance/excel', {
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
            link.setAttribute('download', 'trial-balance.xlsx');
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            console.error('Export failed', error);
            alert('Failed to export report');
        }
    };

    const totalDebit = reportData
        .filter(r => r.closing_balance_type === 'Dr')
        .reduce((sum, r) => sum + Number(r.closing_balance), 0);

    const totalCredit = reportData
        .filter(r => r.closing_balance_type === 'Cr')
        .reduce((sum, r) => sum + Number(r.closing_balance), 0);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Trial Balance</h1>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={handleExportExcel}>
                        <FileSpreadsheet className="w-4 h-4" />
                        Export Excel
                    </Button>
                </div>
            </div>

            <div className="card">
                <div className="flex items-end gap-4 mb-6 p-4 bg-slate-50 rounded-lg">
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

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b-2 border-slate-200 bg-slate-50">
                                <th className="py-3 px-4 font-bold text-slate-700">Particulars</th>
                                <th className="py-3 px-4 font-bold text-slate-700">Group</th>
                                <th className="py-3 px-4 font-bold text-slate-700 text-right">Debit</th>
                                <th className="py-3 px-4 font-bold text-slate-700 text-right">Credit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={4} className="text-center py-8">Loading...</td></tr>
                            ) : reportData.length === 0 ? (
                                <tr><td colSpan={4} className="text-center py-8 text-slate-500">No data available</td></tr>
                            ) : (
                                reportData.map((row) => (
                                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="py-2 px-4 font-medium text-slate-800">{row.name}</td>
                                        <td className="py-2 px-4 text-slate-500 text-sm">{row.group_name}</td>
                                        <td className="py-2 px-4 text-right font-mono text-slate-700">
                                            {row.closing_balance_type === 'Dr' ? Number(row.closing_balance).toLocaleString() : ''}
                                        </td>
                                        <td className="py-2 px-4 text-right font-mono text-slate-700">
                                            {row.closing_balance_type === 'Cr' ? Number(row.closing_balance).toLocaleString() : ''}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                        <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                            <tr>
                                <td colSpan={2} className="py-3 px-4 text-right text-slate-800">Total:</td>
                                <td className="py-3 px-4 text-right text-slate-900">₹{totalDebit.toLocaleString()}</td>
                                <td className="py-3 px-4 text-right text-slate-900">₹{totalCredit.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
};
