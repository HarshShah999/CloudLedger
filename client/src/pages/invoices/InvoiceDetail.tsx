import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ArrowLeft, ArrowRightCircle, IndianRupee, Trash2, Edit, Ban } from 'lucide-react';
import { CONVERSIONS, DocType, STATUS_OPTIONS, STATUS_STYLE, docInfo, isPostingType } from '../../lib/docTypes';
import { ShareMenu } from '../../components/ShareMenu';
import { DocumentHistory } from '../../components/DocumentHistory';
import { EDocsPanel } from '../../components/EDocsPanel';
import api, { apiError } from '../../api/axios';
import { useCompany } from '../../context/CompanyContext';
import { notify } from '../../utils/notification';
import { formatDateTime, inr } from '../../lib/format';
import { formatDate } from '../../lib/dates';

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
    const { selectedCompany, canWrite } = useCompany();
    const [invoice, setInvoice] = useState<any>(null);
    const [items, setItems] = useState<any[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [loading, setLoading] = useState(true);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentForm, setPaymentForm] = useState({
        paymentDate: new Date().toISOString().split('T')[0],
        amount: 0,
        paymentMode: 'Cash',
        depositLedgerId: '',
        referenceNumber: '',
        notes: ''
    });
    // Cash and bank accounts the money can be received into / paid from
    const [cashBankLedgers, setCashBankLedgers] = useState<{ id: string; name: string; group_code?: string; group_name?: string }[]>([]);

    useEffect(() => {
        if (!selectedCompany) return;
        api.get('/ledgers', { params: { companyId: selectedCompany.id } }).then((res) => {
            const list = res.data.data.ledgers.filter((l: any) =>
                ['CASH_IN_HAND', 'BANK_ACCOUNTS', 'BANK_OD'].includes(l.group_code) || /cash|bank/i.test(l.group_name || '')
            );
            setCashBankLedgers(list);
        }).catch(() => undefined);
    }, [selectedCompany]);

    const isCashLedger = (l: { group_code?: string; group_name?: string }) =>
        l.group_code === 'CASH_IN_HAND' || /cash/i.test(l.group_name || '');

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
                ...paymentForm,
                depositLedgerId: paymentForm.depositLedgerId || null
            });
            notify.success('Payment recorded successfully');
            setShowPaymentModal(false);
            fetchInvoiceDetails();
            setPaymentForm({
                paymentDate: new Date().toISOString().split('T')[0],
                amount: 0,
                paymentMode: 'Cash',
                depositLedgerId: '',
                referenceNumber: '',
                notes: ''
            });
        } catch (error: any) {
            console.error('Failed to record payment', error);
            notify.error(apiError(error, 'Failed to record payment'));
        }
    };

    const handleDeletePayment = async (paymentId: string) => {
        if (!confirm('Are you sure you want to delete this payment?')) return;

        try {
            await api.delete(`/payments/${paymentId}`);
            notify.success('Payment deleted successfully');
            fetchInvoiceDetails();
        } catch (error) {
            console.error('Failed to delete payment', error);
            notify.error(apiError(error, 'Failed to delete payment'));
        }
    };

    const convert = async (to: DocType) => {
        if (!confirm(`Create a ${docInfo(to).label} from ${invoice.invoice_number}?`)) return;
        try {
            const res = await api.post(`/invoices/${id}/convert`, { to });
            notify.success(`${docInfo(to).label} ${res.data.data.invoice.invoice_number} created`);
            navigate(`/invoices/${res.data.data.invoice.id}`);
        } catch (err) {
            notify.error(apiError(err, 'Could not convert'));
        }
    };

    const changeStatus = async (status: string) => {
        try {
            await api.patch(`/invoices/${id}/status`, { status });
            fetchInvoiceDetails();
        } catch (err) {
            notify.error(apiError(err, 'Could not change status'));
        }
    };

    const cancelDocument = async () => {
        const reason = window.prompt(
            `Cancel ${invoice.invoice_number}?\n\nThe number stays used and is shown as cancelled in GSTR-1. Its accounting entry and stock movement are reversed. This cannot be undone.\n\nReason (optional):`,
            ''
        );
        if (reason === null) return;
        try {
            await api.post(`/invoices/${id}/cancel`, { reason });
            notify.success(`${invoice.invoice_number} cancelled`);
            fetchInvoiceDetails();
        } catch (err) {
            notify.error(apiError(err, 'Could not cancel'));
        }
    };

    if (loading) return <div className="text-center py-8">Loading...</div>;
    if (!invoice) return <div className="text-center py-8">Invoice not found</div>;

    const isInterState = invoice.company_state !== invoice.party_state;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                    <Button variant="secondary" onClick={() => navigate(`/invoices?type=${invoice.type}`)}>
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </Button>
                    <h1 className="text-2xl font-bold text-slate-800">
                        {invoice.is_opening ? 'Opening bill' : docInfo(invoice.type).label} {invoice.invoice_number}
                    </h1>
                </div>
                <div className="flex flex-wrap gap-2">
                    {invoice.status !== 'CONVERTED' && invoice.status !== 'CANCELLED' && !invoice.is_opening && (
                        <Button variant="secondary" onClick={() => navigate(`/invoices/${id}/edit`)}>
                            <Edit className="w-4 h-4" />
                            Edit
                        </Button>
                    )}
                    {(CONVERSIONS[invoice.type as DocType] || []).map((to) =>
                        invoice.status === 'CONVERTED' || invoice.status === 'DECLINED' ? null : (
                            <Button key={to} onClick={() => convert(to)}>
                                <ArrowRightCircle className="w-4 h-4" />
                                Convert to {docInfo(to).label}
                            </Button>
                        )
                    )}
                    <ShareMenu target={{ kind: 'invoice', id: invoice.id, label: invoice.invoice_number }} />
                    {isPostingType(invoice.type) && !invoice.is_opening && invoice.status !== 'CANCELLED' && (
                        <Button variant="secondary" onClick={cancelDocument}>
                            <Ban className="w-4 h-4" />
                            Cancel
                        </Button>
                    )}
                    {isPostingType(invoice.type) && invoice.status !== 'CANCELLED' && Number(invoice.outstanding_amount) > 0 && (
                        <Button onClick={() => { setPaymentForm((f) => ({ ...f, amount: Number(invoice.outstanding_amount ?? invoice.grand_total) })); setShowPaymentModal(true); }}>
                            <IndianRupee className="w-4 h-4" />
                            Record Payment
                        </Button>
                    )}
                </div>
            </div>

            {invoice.status === 'CANCELLED' && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <b>Cancelled</b>{invoice.cancelled_at ? ` on ${formatDateTime(invoice.cancelled_at)}` : ''}
                    {invoice.cancel_reason ? ` — ${invoice.cancel_reason}` : ''}. The number stays used and is reported as cancelled in GSTR-1; nothing is posted to the books.
                </div>
            )}

            {/* Invoice Header */}
            <div className="card grid grid-cols-1 sm:grid-cols-2 gap-6">
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
                    <p className="text-sm text-slate-600">Date: {formatDate(invoice.date)}</p>
                    {invoice.due_date && <p className="text-sm text-slate-600">Due Date: {formatDate(invoice.due_date)}</p>}
                </div>
                <div>
                    <p className="text-sm text-slate-600">Type: {docInfo(invoice.type).label}</p>
                    {invoice.source_document_id && (
                        <p className="text-sm text-slate-600">
                            Created from{' '}
                            <a className="text-primary underline" href={`/invoices/${invoice.source_document_id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${invoice.source_document_id}`); }}>
                                {docInfo(invoice.source_document_type).label} {invoice.source_document_number}
                            </a>
                        </p>
                    )}
                    {(invoice.converted_to || []).map((c: any) => (
                        <p key={c.id} className="text-sm text-slate-600">
                            Converted to{' '}
                            <a className="text-primary underline" href={`/invoices/${c.id}`} onClick={(e) => { e.preventDefault(); navigate(`/invoices/${c.id}`); }}>
                                {docInfo(c.type).label} {c.number}
                            </a>
                        </p>
                    ))}
                    {!isPostingType(invoice.type) && (
                        <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                            Status:
                            {invoice.status === 'CONVERTED' ? (
                                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE.CONVERTED}`}>CONVERTED</span>
                            ) : (
                                <select className="input-field w-auto py-1" value={invoice.status} onChange={(e) => changeStatus(e.target.value)}>
                                    {(STATUS_OPTIONS[invoice.type as DocType] || []).map((st) => (
                                        <option key={st} value={st}>{st}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    )}
                    {isPostingType(invoice.type) && (
                    <p className="text-sm text-slate-600">Status: <span className={`font-medium ${invoice.payment_status === 'PAID' ? 'text-green-600' :
                        invoice.payment_status === 'PARTIAL' ? 'text-yellow-600' : 'text-red-600'
                        }`}>{invoice.payment_status}</span></p>
                    )}
                </div>
            </div>

            {/* Items Table */}
            <div className="card">
                <h3 className="font-semibold text-slate-700 mb-4">Items</h3>
                <div className="overflow-x-auto">
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
                                <td className="py-2 px-3 text-right">{inr(Number(item.rate))}</td>
                                <td className="py-2 px-3 text-right">{inr(Number(item.amount))}</td>
                                <td className="py-2 px-3 text-right">{inr(Number(item.discount_amount || 0))}</td>
                                <td className="py-2 px-3 text-right">{inr(Number(item.taxable_amount))}</td>
                                <td className="py-2 px-3 text-right text-sm">
                                    {isInterState ? (
                                        <div>IGST: {inr(Number(item.igst_amount))}</div>
                                    ) : (
                                        <>
                                            <div>CGST: {inr(Number(item.cgst_amount))}</div>
                                            <div>SGST: {inr(Number(item.sgst_amount))}</div>
                                        </>
                                    )}
                                </td>
                                <td className="py-2 px-3 text-right font-medium">{inr(Number(item.total_amount))}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
            </div>

            {/* Totals */}
            <div className="card bg-slate-50">
                <div className="flex justify-end">
                    <div className="w-full sm:w-96 space-y-2">
                        {Number(invoice.discount_amount) > 0 && (
                            <div className="flex justify-between text-red-600">
                                <span>Invoice Discount ({Number(invoice.discount_percent)}%):</span>
                                <span className="tabular-nums">-{inr(Number(invoice.discount_amount))}</span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span>Taxable Value:</span>
                            <span className="tabular-nums">{inr(Number(invoice.subtotal))}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>GST:</span>
                            <span className="tabular-nums">{inr(Number(invoice.tax_total))}</span>
                        </div>
                        {Number(invoice.round_off) !== 0 && (
                            <div className="flex justify-between">
                                <span>Round Off:</span>
                                <span className="tabular-nums">{Number(invoice.round_off) > 0 ? '+' : '-'}{inr(Math.abs(Number(invoice.round_off)))}</span>
                            </div>
                        )}
                        <div className="flex justify-between font-bold text-lg border-t pt-2">
                            <span>Grand Total:</span>
                            <span className="tabular-nums">{inr(Number(invoice.grand_total))}</span>
                        </div>
                        {isPostingType(invoice.type) && (<>
                        <div className="flex justify-between text-green-600">
                            <span>Paid:</span>
                            <span className="tabular-nums">{inr(Number(invoice.paid_amount || 0))}</span>
                        </div>
                        <div className="flex justify-between text-red-600 font-medium">
                            <span>Outstanding:</span>
                            <span className="tabular-nums">{inr(Number(invoice.outstanding_amount ?? invoice.grand_total))}</span>
                        </div>
                        </>)}
                    </div>
                </div>
            </div>

            {/* Payment History */}
            {payments.length > 0 && (
                <div className="card">
                    <h3 className="font-semibold text-slate-700 mb-4">Payment History</h3>
                    <div className="overflow-x-auto">
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
                                    <td className="py-2 px-3">{formatDate(payment.payment_date)}</td>
                                    <td className="py-2 px-3 tabular-nums">{inr(Number(payment.amount))}</td>
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
                                    onChange={(e) => {
                                        const mode = e.target.value;
                                        const cash = cashBankLedgers.find(isCashLedger);
                                        const bank = cashBankLedgers.find((l) => !isCashLedger(l));
                                        setPaymentForm({
                                            ...paymentForm,
                                            paymentMode: mode,
                                            depositLedgerId: (mode === 'Cash' ? cash?.id : bank?.id) || '',
                                        });
                                    }}
                                >
                                    <option value="Cash">Cash</option>
                                    <option value="Bank">Bank Transfer</option>
                                    <option value="Cheque">Cheque</option>
                                    <option value="UPI">UPI</option>
                                    <option value="Card">Card</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    {invoice.type === 'SALES' || invoice.type === 'DEBIT_NOTE' ? 'Received into' : 'Paid from'}
                                </label>
                                <select
                                    className="input-field"
                                    value={paymentForm.depositLedgerId}
                                    onChange={(e) => setPaymentForm({ ...paymentForm, depositLedgerId: e.target.value })}
                                >
                                    <option value="">{paymentForm.paymentMode === 'Cash' ? 'Cash (default)' : 'Select bank account'}</option>
                                    {cashBankLedgers.map((l) => (
                                        <option key={l.id} value={l.id}>{l.name}</option>
                                    ))}
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

            <EDocsPanel invoice={invoice} canWrite={canWrite} onChange={fetchInvoiceDetails} />
            <DocumentHistory recordId={invoice.id} />
        </div>
    );
};
