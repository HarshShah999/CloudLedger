import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Plus, Trash2, Edit, Play, Calendar } from 'lucide-react';
import api from '../../api/axios';
import { useNavigate } from 'react-router-dom';

interface RecurringInvoice {
    id: string;
    profile_name: string;
    cron_expression: string;
    next_invoice_date: string;
    is_active: boolean;
    last_generated_date: string | null;
    party_name: string;
    amount: number;
}

export const RecurringInvoiceList: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoice[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchRecurringInvoices = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const response = await api.get(`/recurring-invoices?companyId=${selectedCompany.id}`);
            setRecurringInvoices(response.data.data.recurringInvoices);
        } catch (error) {
            console.error('Failed to fetch recurring invoices', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRecurringInvoices();
    }, [selectedCompany]);

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this recurring invoice template?')) return;
        try {
            await api.delete(`/recurring-invoices/${id}`);
            alert('Recurring invoice deleted successfully');
            fetchRecurringInvoices();
        } catch (error: any) {
            console.error('Failed to delete recurring invoice', error);
            alert(error.response?.data?.message || 'Failed to delete recurring invoice');
        }
    };

    const handleToggleStatus = async (id: string, currentStatus: boolean) => {
        try {
            await api.patch(`/recurring-invoices/${id}`, { is_active: !currentStatus });
            fetchRecurringInvoices();
        } catch (error: any) {
            console.error('Failed to update status', error);
            alert('Failed to update status');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Recurring Invoices</h1>
                <Button onClick={() => navigate('/recurring-invoices/create')}>
                    <Plus className="w-4 h-4" />
                    New Recurring Invoice
                </Button>
            </div>

            <div className="card">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200">
                                <th className="py-3 px-4 font-semibold text-slate-600">Profile Name</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Party</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Frequency (Cron)</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Next Run</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Last Run</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Status</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={7} className="text-center py-8">Loading...</td></tr>
                            ) : recurringInvoices.length === 0 ? (
                                <tr><td colSpan={7} className="text-center py-8 text-slate-500">No recurring invoices found</td></tr>
                            ) : (
                                recurringInvoices.map((invoice) => (
                                    <tr key={invoice.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 font-medium text-slate-800">{invoice.profile_name}</td>
                                        <td className="py-3 px-4 text-slate-600">{invoice.party_name}</td>
                                        <td className="py-3 px-4 font-mono text-sm text-slate-600">{invoice.cron_expression}</td>
                                        <td className="py-3 px-4 text-slate-600">
                                            {new Date(invoice.next_invoice_date).toLocaleDateString()}
                                        </td>
                                        <td className="py-3 px-4 text-slate-600">
                                            {invoice.last_generated_date ? new Date(invoice.last_generated_date).toLocaleDateString() : '-'}
                                        </td>
                                        <td className="py-3 px-4">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${invoice.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}`}>
                                                {invoice.is_active ? 'Active' : 'Paused'}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            <div className="flex gap-2 justify-end">
                                                <button
                                                    onClick={() => handleToggleStatus(invoice.id, invoice.is_active)}
                                                    className={`p-1 transition-colors ${invoice.is_active ? 'text-green-600 hover:text-green-700' : 'text-slate-400 hover:text-green-600'}`}
                                                    title={invoice.is_active ? "Pause" : "Activate"}
                                                >
                                                    <Play className={`w-4 h-4 ${invoice.is_active ? '' : 'opacity-50'}`} />
                                                </button>
                                                <button
                                                    onClick={() => navigate(`/recurring-invoices/${invoice.id}/edit`)}
                                                    className="p-1 text-slate-400 hover:text-orange-500 transition-colors"
                                                    title="Edit"
                                                >
                                                    <Edit className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(invoice.id)}
                                                    className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
