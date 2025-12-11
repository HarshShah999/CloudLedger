
import React, { useState, useEffect } from 'react';
import { useCompany } from '../../context/CompanyContext';
import api from '../../api/axios';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { format } from 'date-fns';
import { Download, Filter } from 'lucide-react';

export const GSTR3B: React.FC = () => {
    const { selectedCompany } = useCompany();
    const [loading, setLoading] = useState(false);

    const [fromDate, setFromDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
    const [toDate, setToDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), 'yyyy-MM-dd'));

    const [data, setData] = useState<{
        outward_supplies: any;
        eligible_itc: any;
    }>({
        outward_supplies: { taxable_value: 0, igst: 0, cgst: 0, sgst: 0 },
        eligible_itc: { taxable_value: 0, igst: 0, cgst: 0, sgst: 0 }
    });

    const fetchData = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const response = await api.get(`/gst/gstr3b/${selectedCompany.id}`, {
                params: { fromDate, toDate }
            });
            setData(response.data.data);
        } catch (error) {
            console.error('Failed to fetch GSTR-3B data', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [selectedCompany]);

    const formatCurrency = (amount: number) => {
        return `₹${Number(amount).toFixed(2)}`;
    };

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-slate-800">GSTR-3B (Summary Return)</h1>
                <div className="flex gap-3">
                    <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-200">
                        <Input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="border-none focus:ring-0"
                        />
                        <span className="text-slate-400">to</span>
                        <Input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            className="border-none focus:ring-0"
                        />
                    </div>
                    <Button onClick={fetchData} variant="secondary">
                        <Filter className="w-4 h-4 mr-2" />
                        Apply
                    </Button>
                    <Button variant="primary">
                        <Download className="w-4 h-4 mr-2" />
                        Export JSON
                    </Button>
                </div>
            </div>

            <Card className="mb-6">
                <div className="p-4 border-b border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">3.1 Details of Outward Supplies and inward supplies liable to reverse charge</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Nature of Supplies</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Total Taxable Value</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Integrated Tax</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Central Tax</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">State/UT Tax</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Cess</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {loading ? (
                                <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-500">Loading...</td></tr>
                            ) : (
                                <tr className="hover:bg-slate-50">
                                    <td className="px-4 py-3 text-sm text-slate-900 font-medium">(a) Outward taxable supplies (other than zero rated, nil rated and exempted)</td>
                                    <td className="px-4 py-3 text-sm text-right text-slate-900">{formatCurrency(data.outward_supplies.taxable_value)}</td>
                                    <td className="px-4 py-3 text-sm text-right text-slate-900">{formatCurrency(data.outward_supplies.igst)}</td>
                                    <td className="px-4 py-3 text-sm text-right text-slate-900">{formatCurrency(data.outward_supplies.cgst)}</td>
                                    <td className="px-4 py-3 text-sm text-right text-slate-900">{formatCurrency(data.outward_supplies.sgst)}</td>
                                    <td className="px-4 py-3 text-sm text-right text-slate-900">₹0.00</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Card>
                <div className="p-4 border-b border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">4. Eligible ITC</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Details</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Integrated Tax</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Central Tax</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">State/UT Tax</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Cess</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {loading ? (
                                <tr><td colSpan={5} className="px-4 py-4 text-center text-slate-500">Loading...</td></tr>
                            ) : (
                                <tr className="hover:bg-slate-50">
                                    <td className="px-4 py-3 text-sm text-slate-900 font-medium">(A) ITC Available (whether in full or part)</td>
                                    <td className="px-4 py-3 text-sm text-right text-slate-900">{formatCurrency(data.eligible_itc.igst)}</td>
                                    <td className="px-4 py-3 text-sm text-right text-slate-900">{formatCurrency(data.eligible_itc.cgst)}</td>
                                    <td className="px-4 py-3 text-sm text-right text-slate-900">{formatCurrency(data.eligible_itc.sgst)}</td>
                                    <td className="px-4 py-3 text-sm text-right text-slate-900">₹0.00</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};
