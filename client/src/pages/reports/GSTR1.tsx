
import React, { useState, useEffect } from 'react';
import { useCompany } from '../../context/CompanyContext';
import api from '../../api/axios';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { format } from 'date-fns';
import { Download, Filter } from 'lucide-react';

export const GSTR1: React.FC = () => {
    const { selectedCompany } = useCompany();
    const [loading, setLoading] = useState(false);

    const [fromDate, setFromDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
    const [toDate, setToDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), 'yyyy-MM-dd'));

    const [data, setData] = useState<{
        b2b: any[];
        b2cLarge: any[];
        b2cSmall: any[];
    }>({ b2b: [], b2cLarge: [], b2cSmall: [] });

    const fetchData = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const response = await api.get(`/gst/gstr1/${selectedCompany.id}`, {
                params: { fromDate, toDate }
            });
            setData(response.data.data);
        } catch (error) {
            console.error('Failed to fetch GSTR-1 data', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [selectedCompany]);

    const calculateTotals = (invoices: any[]) => {
        return invoices.reduce((acc: any, inv: any) => ({
            taxable: acc.taxable + Number(inv.subtotal),
            tax: acc.tax + Number(inv.tax_total),
            total: acc.total + Number(inv.grand_total)
        }), { taxable: 0, tax: 0, total: 0 });
    };

    const b2bTotals = calculateTotals(data.b2b);
    const b2cLargeTotals = calculateTotals(data.b2cLarge);
    const b2cSmallTotals = calculateTotals(data.b2cSmall);

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-slate-800">GSTR-1 (Outward Supplies)</h1>
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <Card className="p-4">
                    <p className="text-sm text-slate-500 font-medium">B2B Invoices</p>
                    <div className="mt-2">
                        <p className="text-2xl font-bold text-slate-800">{data.b2b.length}</p>
                        <p className="text-sm text-slate-500">
                            Count: {data.b2b.length} | Tax: ₹{b2bTotals.tax.toFixed(2)}
                        </p>
                    </div>
                </Card>
                <Card className="p-4">
                    <p className="text-sm text-slate-500 font-medium">B2C Large Invoices</p>
                    <div className="mt-2">
                        <p className="text-2xl font-bold text-slate-800">{data.b2cLarge.length}</p>
                        <p className="text-sm text-slate-500">
                            Count: {data.b2cLarge.length} | Tax: ₹{b2cLargeTotals.tax.toFixed(2)}
                        </p>
                    </div>
                </Card>
                <Card className="p-4">
                    <p className="text-sm text-slate-500 font-medium">B2C Small Invoices</p>
                    <div className="mt-2">
                        <p className="text-2xl font-bold text-slate-800">{data.b2cSmall.length}</p>
                        <p className="text-sm text-slate-500">
                            Count: {data.b2cSmall.length} | Tax: ₹{b2cSmallTotals.tax.toFixed(2)}
                        </p>
                    </div>
                </Card>
            </div>

            <Card className="mb-6">
                <div className="p-4 border-b border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">4A, 4B, 4C, 6B, 6C - B2B Invoices</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">GSTIN/UIN</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Receiver Name</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Invoice No</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Invoice Value</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Taxable Value</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Total Tax</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {loading ? (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
                            ) : data.b2b.length === 0 ? (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No B2B invoices found</td></tr>
                            ) : (
                                data.b2b.map((inv) => (
                                    <tr key={inv.id} className="hover:bg-slate-50">
                                        <td className="px-4 py-3 text-sm text-slate-900">{inv.party_gstin}</td>
                                        <td className="px-4 py-3 text-sm text-slate-900">{inv.party_name}</td>
                                        <td className="px-4 py-3 text-sm text-slate-900">{inv.invoice_number}</td>
                                        <td className="px-4 py-3 text-sm text-slate-500">{format(new Date(inv.date), 'dd-MM-yyyy')}</td>
                                        <td className="px-4 py-3 text-sm text-right text-slate-900">₹{Number(inv.grand_total).toFixed(2)}</td>
                                        <td className="px-4 py-3 text-sm text-right text-slate-900">₹{Number(inv.subtotal).toFixed(2)}</td>
                                        <td className="px-4 py-3 text-sm text-right text-slate-900">₹{Number(inv.tax_total).toFixed(2)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Card>
                <div className="p-4 border-b border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">5A, 5B - B2C (Large) Invoices</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Place Of Supply</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Invoice No</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Invoice Value</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Taxable Value</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Total Tax</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {data.b2cLarge.length === 0 ? (
                                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No B2C Large invoices found</td></tr>
                            ) : (
                                data.b2cLarge.map((inv) => (
                                    <tr key={inv.id} className="hover:bg-slate-50">
                                        <td className="px-4 py-3 text-sm text-slate-900">{inv.party_state}</td>
                                        <td className="px-4 py-3 text-sm text-slate-900">{inv.invoice_number}</td>
                                        <td className="px-4 py-3 text-sm text-slate-500">{format(new Date(inv.date), 'dd-MM-yyyy')}</td>
                                        <td className="px-4 py-3 text-sm text-right text-slate-900">₹{Number(inv.grand_total).toFixed(2)}</td>
                                        <td className="px-4 py-3 text-sm text-right text-slate-900">₹{Number(inv.subtotal).toFixed(2)}</td>
                                        <td className="px-4 py-3 text-sm text-right text-slate-900">₹{Number(inv.tax_total).toFixed(2)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};
