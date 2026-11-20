import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Plus, Download, Trash2, Eye, DollarSign, Edit } from 'lucide-react';
import { ShareMenu } from '../../components/ShareMenu';
import api, { apiError } from '../../api/axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DOC_TYPES, DocType, docInfo, STATUS_STYLE } from '../../lib/docTypes';
import { notify } from '../../utils/notification';

interface Invoice {
    id: string;
    invoice_number: string;
    date: string;
    party_name: string;
    type: string;
    grand_total: number;
    paid_amount: number;
    outstanding_amount: number;
    payment_status: string;
    status?: string;
}

export const InvoiceList: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const filterType = (DOC_TYPES.find((d) => d.type === searchParams.get('type'))?.type ?? 'SALES') as DocType;
    const setFilterType = (t: DocType) => {
        setPaymentFilter('');
        setSearchParams({ type: t }, { replace: true });
    };
    const info = docInfo(filterType);
    const [paymentFilter, setPaymentFilter] = useState<string>('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const fetchInvoices = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const params: any = {
                companyId: selectedCompany.id,
                type: filterType
            };
            if (paymentFilter) {
                params.paymentStatus = paymentFilter;
            }

            const response = await api.get('/invoices', { params });
            setInvoices(response.data.data.invoices);
        } catch (error) {
            console.error('Failed to fetch invoices', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInvoices();
    }, [selectedCompany, filterType, paymentFilter]);

    const handleDownloadPDF = async (invoiceId: string, invoiceNumber: string) => {
        try {
            const response = await api.get(`/invoices/${invoiceId}/pdf`, {
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `invoice-${invoiceNumber}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            console.error('Failed to download PDF', error);
            notify.error(apiError(error, 'Failed to download PDF'));
        }
    };

    const handleDelete = async (invoiceId: string) => {
        try {
            await api.delete(`/invoices/${invoiceId}`);
            notify.success('Invoice deleted successfully');
            fetchInvoices();
            setDeleteConfirm(null);
        } catch (error: any) {
            console.error('Failed to delete invoice', error);
            notify.error(apiError(error, 'Failed to delete invoice'));
        }
    };

    const getPaymentStatusBadge = (status: string) => {
        const styles = {
            PAID: 'bg-green-100 text-green-800',
            PARTIAL: 'bg-yellow-100 text-yellow-800',
            UNPAID: 'bg-red-100 text-red-800'
        };
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles] || styles.UNPAID}`}>
                {status}
            </span>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-bold text-slate-800">Sales & Purchases</h1>
                <Button onClick={() => navigate(`/invoices/create/${info.slug}`)}>
                    <Plus className="w-4 h-4" />
                    New {info.label}
                </Button>
            </div>
            <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
                <div className="flex w-max gap-1 rounded-xl bg-slate-100 p-1">
                    {DOC_TYPES.map((d) => (
                        <button
                            key={d.type}
                            onClick={() => setFilterType(d.type)}
                            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${filterType === d.type ? 'bg-white text-primary shadow' : 'text-slate-600 hover:text-slate-800'}`}
                        >
                            {d.plural}
                        </button>
                    ))}
                </div>
            </div>

            {/* Payment Status Filter */}
            {info.posting && (
            <div className="card">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">Filter by Payment:</span>
                    <button
                        onClick={() => setPaymentFilter('')}
                        className={`px-3 py-1 rounded text-sm ${!paymentFilter ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                        All
                    </button>
                    <button
                        onClick={() => setPaymentFilter('UNPAID')}
                        className={`px-3 py-1 rounded text-sm ${paymentFilter === 'UNPAID' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                        Unpaid
                    </button>
                    <button
                        onClick={() => setPaymentFilter('PARTIAL')}
                        className={`px-3 py-1 rounded text-sm ${paymentFilter === 'PARTIAL' ? 'bg-yellow-500 text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                        Partial
                    </button>
                    <button
                        onClick={() => setPaymentFilter('PAID')}
                        className={`px-3 py-1 rounded text-sm ${paymentFilter === 'PAID' ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                        Paid
                    </button>
                </div>
            </div>
            )}

            <div className="card">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200">
                                <th className="py-3 px-4 font-semibold text-slate-600">Date</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Invoice No</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Party Name</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 text-right">Amount</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 text-right">Paid</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 text-right">Outstanding</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Status</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8} className="text-center py-8">Loading...</td></tr>
                            ) : invoices.length === 0 ? (
                                <tr><td colSpan={8} className="text-center py-8 text-slate-500">No invoices found</td></tr>
                            ) : (
                                invoices.map((invoice) => (
                                    <tr key={invoice.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-slate-600">
                                            {new Date(invoice.date).toLocaleDateString()}
                                        </td>
                                        <td className="py-3 px-4 font-medium text-slate-800">
                                            {invoice.invoice_number}
                                        </td>
                                        <td className="py-3 px-4 text-slate-600">{invoice.party_name}</td>
                                        <td className="py-3 px-4 text-right font-mono font-medium text-slate-800">
                                            ₹{Number(invoice.grand_total).toLocaleString()}
                                        </td>
                                        <td className="py-3 px-4 text-right font-mono text-green-600">
                                            ₹{Number(invoice.paid_amount || 0).toLocaleString()}
                                        </td>
                                        <td className="py-3 px-4 text-right font-mono text-red-600">
                                            ₹{Number(invoice.outstanding_amount ?? invoice.grand_total).toLocaleString()}
                                        </td>
                                        <td className="py-3 px-4">
                                            {info.posting ? (
                                                getPaymentStatusBadge(invoice.payment_status || 'UNPAID')
                                            ) : (
                                                <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_STYLE[invoice.status || ''] || ''}`}>
                                                    {invoice.status}
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            <div className="flex gap-2 justify-end">
                                                <button
                                                    onClick={() => navigate(`/invoices/${invoice.id}`)}
                                                    className="p-1 text-slate-400 hover:text-primary transition-colors"
                                                    title="View Invoice"
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDownloadPDF(invoice.id, invoice.invoice_number)}
                                                    className="p-1 text-slate-400 hover:text-blue-600 transition-colors"
                                                    title="Download PDF"
                                                >
                                                    <Download className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => navigate(`/invoices/${invoice.id}`)}
                                                    className="p-1 text-slate-400 hover:text-green-600 transition-colors"
                                                    title="Record Payment"
                                                >
                                                    <DollarSign className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => navigate(`/invoices/${invoice.id}/edit`)}
                                                    className="p-1 text-slate-400 hover:text-orange-500 transition-colors"
                                                    title="Edit Invoice"
                                                >
                                                    <Edit className="w-4 h-4" />
                                                </button>
                                                <ShareMenu appearance="icon" target={{ kind: 'invoice', id: invoice.id, label: invoice.invoice_number }} />
                                                <button
                                                    onClick={() => setDeleteConfirm(invoice.id)}
                                                    className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                                                    title="Delete Invoice"
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

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl p-6 max-w-md">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">Confirm Delete</h2>
                        <p className="text-slate-600 mb-6">
                            Are you sure you want to delete this invoice? This will reverse all accounting entries and inventory changes.
                        </p>
                        <div className="flex justify-end gap-3">
                            <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={() => handleDelete(deleteConfirm)}
                                className="bg-red-600 hover:bg-red-700"
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};
