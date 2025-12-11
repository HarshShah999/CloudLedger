import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ArrowLeft, Download, DollarSign, Trash2, Edit, Mail } from 'lucide-react';
import api from '../../api/axios';
import { useCompany } from '../../context/CompanyContext';

interface Payment {
    id: string;
    payment_date: string;
    amount: number;
    payment_mode: string;
    reference_number: string;
    notes: string;
}

export const InvoiceDetail: React.FC = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { selectedCompany } = useCompany();
    const [invoice, setInvoice] = useState<any>(null);
    const [items, setItems] = useState<any[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [loading, setLoading] = useState(true);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [showEmailModal, setShowEmailModal] = useState(false);
    const [emailForm, setEmailForm] = useState({
        to: '',
        cc: '',
        subject: '',
        message: ''
    });
    const [sendingEmail, setSendingEmail] = useState(false);

    const [paymentForm, setPaymentForm] = useState({
        paymentDate: new Date().toISOString().split('T')[0],
        amount: 0,
        paymentMode: 'Cash',
        referenceNumber: '',
        notes: ''
    });

    const fetchInvoiceDetails = async () => {
        try {
            const response = await api.get(`/invoices/${id}`);
            setInvoice(response.data.data.invoice);
            setItems(response.data.data.items);
            setPayments(response.data.data.payments || []);
        } catch (error) {
            console.error('Failed to fetch invoice', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInvoiceDetails();
    }, [id]);

    const handleRecordPayment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany) return;

        try {
            await api.post('/payments', {
                companyId: selectedCompany.id,
                invoiceId: id,
                ...paymentForm
            });
            alert('Payment recorded successfully');
            setShowPaymentModal(false);
            fetchInvoiceDetails();
            setPaymentForm({
                paymentDate: new Date().toISOString().split('T')[0],
                amount: 0,
                paymentMode: 'Cash',
                referenceNumber: '',
                notes: ''
            });
        } catch (error: any) {
            console.error('Failed to record payment', error);
            alert(error.response?.data?.message || 'Failed to record payment');
        }
    };

    const handleDeletePayment = async (paymentId: string) => {
        if (!confirm('Are you sure you want to delete this payment?')) return;

        try {
            await api.delete(`/payments/${paymentId}`);
            alert('Payment deleted successfully');
            fetchInvoiceDetails();
        } catch (error) {
            console.error('Failed to delete payment', error);
            alert('Failed to delete payment');
        }
    };

    const handleSendEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        setSendingEmail(true);
        try {
            await api.post(`/invoices/${id}/email`, emailForm);
            alert('Email sent successfully!');
            setShowEmailModal(false);
            setEmailForm({ to: '', cc: '', subject: '', message: '' });
        } catch (error: any) {
            console.error('Failed to send email', error);
            alert(error.response?.data?.message || 'Failed to send email');
        } finally {
            setSendingEmail(false);
        }
    };

    const openEmailModal = () => {
        setShowEmailModal(true);
        setEmailForm({
            to: '',
            cc: '',
            subject: `Invoice #${invoice.invoice_number} from CloudLedger`,
            message: `Dear Sir/Madam,\n\nPlease find attached the invoice #${invoice.invoice_number}.\n\nRegards,\nCloudLedger`
        });
    };

    const handleDownloadPDF = async () => {
        try {
            const response = await api.get(`/invoices/${id}/pdf`, {
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `invoice-${invoice.invoice_number}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            console.error('Failed to download PDF', error);
            alert('Failed to download PDF');
        }
    };

    if (loading) return <div className="text-center py-8">Loading...</div>;
    if (!invoice) return <div className="text-center py-8">Invoice not found</div>;

    const isInterState = invoice.company_state !== invoice.party_state;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="secondary" onClick={() => navigate('/invoices')}>
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </Button>
                    <h1 className="text-2xl font-bold text-slate-800">
                        Invoice #{invoice.invoice_number}
                    </h1>
                </div>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={handleDownloadPDF}>
                        <Download className="w-4 h-4" />
                        Download PDF
                    </Button>
                    <Button variant="secondary" onClick={() => navigate(`/invoices/${id}/edit`)}>
                        <Edit className="w-4 h-4" />
                        Edit
                    </Button>
                    <Button variant="secondary" onClick={openEmailModal}>
                        <Mail className="w-4 h-4" />
                        Email
                    </Button>
                    {Number(invoice.outstanding_amount) > 0 && (
                        <Button onClick={() => setShowPaymentModal(true)}>
                            <DollarSign className="w-4 h-4" />
                            Record Payment
                        </Button>
                    )}
                </div>
            </div>

            {/* Invoice Header */}
            <div className="card grid grid-cols-2 gap-6">
                <div>
                    <h3 className="font-semibold text-slate-700 mb-2">Company Details</h3>
                    <p className="text-slate-800 font-medium">{invoice.company_name}</p>
                    {invoice.company_gstin && <p className="text-sm text-slate-600">GSTIN: {invoice.company_gstin}</p>}
                    {invoice.company_state && <p className="text-sm text-slate-600">State: {invoice.company_state}</p>}
                </div>
                <div>
                    <h3 className="font-semibold text-slate-700 mb-2">Party Details</h3>
                    <p className="text-slate-800 font-medium">{invoice.party_name}</p>
                    {invoice.party_gstin && <p className="text-sm text-slate-600">GSTIN: {invoice.party_gstin}</p>}
                    {invoice.party_state && <p className="text-sm text-slate-600">State: {invoice.party_state}</p>}
                </div>
                <div>
                    <p className="text-sm text-slate-600">Date: {new Date(invoice.date).toLocaleDateString()}</p>
                    {invoice.due_date && <p className="text-sm text-slate-600">Due Date: {new Date(invoice.due_date).toLocaleDateString()}</p>}
                </div>
                <div>
                    <p className="text-sm text-slate-600">Type: {invoice.type}</p>
                    <p className="text-sm text-slate-600">Status: <span className={`font-medium ${invoice.payment_status === 'PAID' ? 'text-green-600' :
                        invoice.payment_status === 'PARTIAL' ? 'text-yellow-600' : 'text-red-600'
                        }`}>{invoice.payment_status}</span></p>
                </div>
            </div>

            {/* Items Table */}
            <div className="card">
                <h3 className="font-semibold text-slate-700 mb-4">Items</h3>
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="py-2 px-3">Item</th>
                            <th className="py-2 px-3">HSN</th>
                            <th className="py-2 px-3 text-right">Qty</th>
                            <th className="py-2 px-3 text-right">Rate</th>
                            <th className="py-2 px-3 text-right">Amount</th>
                            <th className="py-2 px-3 text-right">Discount</th>
                            <th className="py-2 px-3 text-right">Taxable</th>
                            <th className="py-2 px-3 text-right">Tax</th>
                            <th className="py-2 px-3 text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item, index) => (
                            <tr key={index} className="border-b border-slate-100">
                                <td className="py-2 px-3">{item.item_name || item.description}</td>
                                <td className="py-2 px-3">{item.hsn_code}</td>
                                <td className="py-2 px-3 text-right">{Number(item.quantity).toFixed(2)} {item.unit_symbol}</td>
                                <td className="py-2 px-3 text-right">₹{Number(item.rate).toFixed(2)}</td>
                                <td className="py-2 px-3 text-right">₹{Number(item.amount).toFixed(2)}</td>
                                <td className="py-2 px-3 text-right">₹{Number(item.discount_amount || 0).toFixed(2)}</td>
                                <td className="py-2 px-3 text-right">₹{Number(item.taxable_amount).toFixed(2)}</td>
                                <td className="py-2 px-3 text-right text-sm">
                                    {isInterState ? (
                                        <div>IGST: ₹{Number(item.igst_amount).toFixed(2)}</div>
                                    ) : (
                                        <>
                                            <div>CGST: ₹{Number(item.cgst_amount).toFixed(2)}</div>
                                            <div>SGST: ₹{Number(item.sgst_amount).toFixed(2)}</div>
                                        </>
                                    )}
                                </td>
                                <td className="py-2 px-3 text-right font-medium">₹{Number(item.total_amount).toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Totals */}
            <div className="card bg-slate-50">
                <div className="flex justify-end">
                    <div className="w-96 space-y-2">
                        <div className="flex justify-between">
                            <span>Subtotal:</span>
                            <span className="font-mono">₹{Number(invoice.subtotal).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Tax Total:</span>
                            <span className="font-mono">₹{Number(invoice.tax_total).toFixed(2)}</span>
                        </div>
                        {Number(invoice.discount_amount) > 0 && (
                            <div className="flex justify-between text-red-600">
                                <span>Discount:</span>
                                <span className="font-mono">-₹{Number(invoice.discount_amount).toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between font-bold text-lg border-t pt-2">
                            <span>Grand Total:</span>
                            <span className="font-mono">₹{Number(invoice.grand_total).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-green-600">
                            <span>Paid:</span>
                            <span className="font-mono">₹{Number(invoice.paid_amount || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-red-600 font-medium">
                            <span>Outstanding:</span>
                            <span className="font-mono">₹{Number(invoice.outstanding_amount || invoice.grand_total).toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Payment History */}
            {payments.length > 0 && (
                <div className="card">
                    <h3 className="font-semibold text-slate-700 mb-4">Payment History</h3>
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                                <th className="py-2 px-3">Date</th>
                                <th className="py-2 px-3">Amount</th>
                                <th className="py-2 px-3">Mode</th>
                                <th className="py-2 px-3">Reference</th>
                                <th className="py-2 px-3">Notes</th>
                                <th className="py-2 px-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {payments.map((payment) => (
                                <tr key={payment.id} className="border-b border-slate-100">
                                    <td className="py-2 px-3">{new Date(payment.payment_date).toLocaleDateString()}</td>
                                    <td className="py-2 px-3 font-mono">₹{Number(payment.amount).toFixed(2)}</td>
                                    <td className="py-2 px-3">{payment.payment_mode}</td>
                                    <td className="py-2 px-3">{payment.reference_number}</td>
                                    <td className="py-2 px-3">{payment.notes}</td>
                                    <td className="py-2 px-3 text-right">
                                        <button
                                            onClick={() => handleDeletePayment(payment.id)}
                                            className="p-1 text-slate-400 hover:text-red-600"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Payment Modal */}
            {showPaymentModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">Record Payment</h2>
                        <form onSubmit={handleRecordPayment} className="space-y-4">
                            <Input
                                label="Payment Date"
                                type="date"
                                value={paymentForm.paymentDate}
                                onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                                required
                            />
                            <Input
                                label="Amount"
                                type="number"
                                value={paymentForm.amount}
                                onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })}
                                max={Number(invoice.outstanding_amount)}
                                step="0.01"
                                required
                            />
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Payment Mode</label>
                                <select
                                    className="input-field"
                                    value={paymentForm.paymentMode}
                                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentMode: e.target.value })}
                                >
                                    <option value="Cash">Cash</option>
                                    <option value="Bank">Bank Transfer</option>
                                    <option value="Cheque">Cheque</option>
                                    <option value="UPI">UPI</option>
                                    <option value="Card">Card</option>
                                </select>
                            </div>
                            <Input
                                label="Reference Number"
                                value={paymentForm.referenceNumber}
                                onChange={(e) => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })}
                            />
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                                <textarea
                                    className="input-field"
                                    rows={3}
                                    value={paymentForm.notes}
                                    onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                                />
                            </div>
                            <div className="flex justify-end gap-3">
                                <Button type="button" variant="secondary" onClick={() => setShowPaymentModal(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit">
                                    Record Payment
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Email Modal */}
            {showEmailModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">Email Invoice #{invoice.invoice_number}</h2>
                        <form onSubmit={handleSendEmail} className="space-y-4">
                            <Input
                                label="To"
                                type="email"
                                value={emailForm.to}
                                onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })}
                                placeholder="recipient@example.com"
                                required
                            />
                            <Input
                                label="CC"
                                type="text"
                                value={emailForm.cc}
                                onChange={(e) => setEmailForm({ ...emailForm, cc: e.target.value })}
                                placeholder="cc@example.com, another@example.com"
                            />
                            <Input
                                label="Subject"
                                value={emailForm.subject}
                                onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
                                required
                            />
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
                                <textarea
                                    className="input-field"
                                    rows={4}
                                    value={emailForm.message}
                                    onChange={(e) => setEmailForm({ ...emailForm, message: e.target.value })}
                                />
                            </div>
                            <div className="flex justify-end gap-3">
                                <Button type="button" variant="secondary" onClick={() => setShowEmailModal(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit" isLoading={sendingEmail}>
                                    <Mail className="w-4 h-4 mr-2" />
                                    Send Email
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
