import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Printer, Smartphone, CheckCircle2, AlertCircle, Loader2, Landmark } from 'lucide-react';
import { API_URL } from '../../api/axios';
import { formatDate } from '../../lib/dates';

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Public, no-login view of a document shared by link (WhatsApp / email / copied link). */
export const SharedDocument: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const [doc, setDoc] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const pdfUrl = `${API_URL}/public/d/${token}/pdf`;

    useEffect(() => {
        fetch(`${API_URL}/public/d/${token}`)
            .then(async (r) => {
                const body = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(body.message || 'This link is not available');
                setDoc(body.data);
                document.title = `${body.data.title} · ${body.data.company.name}`;
            })
            .catch((e) => setError(e.message));
    }, [token]);

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
                <div className="max-w-sm rounded-2xl bg-white p-8 text-center shadow">
                    <AlertCircle className="mx-auto mb-3 h-12 w-12 text-amber-500" />
                    <h1 className="mb-2 text-lg font-semibold text-slate-800">Link unavailable</h1>
                    <p className="text-sm text-slate-600">{error}</p>
                </div>
            </div>
        );
    }
    if (!doc) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
            </div>
        );
    }

    const c = doc.company;
    const actions = (
        <div className="flex flex-wrap gap-2 print:hidden">
            <a href={`${pdfUrl}?download=1`} className="btn btn-primary">
                <Download className="h-4 w-4" /> Download PDF
            </a>
            <a href={pdfUrl} target="_blank" rel="noreferrer" className="btn btn-secondary">
                <Printer className="h-4 w-4" /> Print
            </a>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-100 px-3 py-6 sm:px-6">
            <div className="mx-auto max-w-3xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-500">
                        {doc.title} from <span className="font-medium text-slate-700">{c.name}</span>
                    </p>
                    {actions}
                </div>

                <div className="overflow-hidden rounded-2xl bg-white shadow">
                    {/* Header */}
                    <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:justify-between">
                        <div className="flex items-start gap-3">
                            {c.has_logo && <img src={`${API_URL}/public/d/${token}/logo`} alt="" className="h-14 w-14 object-contain" />}
                            <div>
                            <h1 className="text-xl font-bold text-slate-900">{c.name}</h1>
                            {c.address && <p className="text-sm text-slate-500">{c.address}</p>}
                            <p className="text-xs text-slate-500">
                                {[c.gstin && `GSTIN ${c.gstin}`, c.phone, c.email].filter(Boolean).join(' · ')}
                            </p>
                            </div>
                        </div>
                        <div className="sm:text-right">
                            <p className="text-sm font-bold uppercase tracking-wide" style={{ color: c.brand_color || '#4338CA' }}>{doc.title}</p>
                            {doc.invoice && (
                                <>
                                    <p className="font-mono text-sm text-slate-800">{doc.invoice.number}</p>
                                    <p className="text-xs text-slate-500">Date {formatDate(doc.invoice.date)}</p>
                                    {doc.invoice.dueDate && <p className="text-xs text-slate-500">Due {formatDate(doc.invoice.dueDate)}</p>}
                                </>
                            )}
                            {doc.statement && (
                                <p className="text-xs text-slate-500">
                                    {formatDate(doc.statement.period.from)} to {formatDate(doc.statement.period.to)}
                                </p>
                            )}
                        </div>
                    </div>

                    {doc.docType === 'INVOICE' ? <InvoiceBody doc={doc} /> : <StatementBody doc={doc} />}
                </div>

                <p className="text-center text-xs text-slate-400">
                    Shared securely via CloudLedger · link valid until {formatDate(String(doc.expiresAt).slice(0, 10))}
                </p>
            </div>
        </div>
    );
};

const InvoiceBody: React.FC<{ doc: any }> = ({ doc }) => {
    const t = doc.totals;
    const cancelled = !!doc.invoice?.cancelled;
    const paid = t.balance <= 0 && !cancelled;
    return (
        <>
            <div className="grid gap-4 border-b border-slate-200 p-5 sm:grid-cols-2">
                <div>
                    <p className="text-xs font-semibold uppercase text-slate-400">Billed to</p>
                    <p className="font-semibold text-slate-800">{doc.party.name}</p>
                    {doc.party.address && <p className="text-sm text-slate-600">{doc.party.address}</p>}
                    {doc.party.gstin && <p className="text-xs text-slate-500">GSTIN {doc.party.gstin}</p>}
                </div>
                <div className="sm:text-right">
                    <p className="text-xs font-semibold uppercase text-slate-400">{paid || cancelled ? 'Status' : 'Amount due'}</p>
                    {cancelled ? (
                        <p className="font-semibold text-red-600">Cancelled: nothing is due</p>
                    ) : paid ? (
                        <p className="inline-flex items-center gap-1 font-semibold text-green-600">
                            <CheckCircle2 className="h-5 w-5" /> Paid in full
                        </p>
                    ) : (
                        <p className="text-2xl font-bold text-slate-900">{inr(t.balance)}</p>
                    )}
                    {doc.invoice.placeOfSupply && <p className="text-xs text-slate-500">Place of supply: {doc.invoice.placeOfSupply}</p>}
                </div>
            </div>

            {/* Items: table on wide screens, cards on phones */}
            <div className="p-5">
                <table className="hidden w-full text-sm sm:table">
                    <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                            <th className="py-2">Item</th>
                            <th className="py-2 text-right">Qty</th>
                            <th className="py-2 text-right">Rate</th>
                            <th className="py-2 text-right">GST</th>
                            <th className="py-2 text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {doc.items.map((it: any, i: number) => (
                            <tr key={i} className="border-b border-slate-100 align-top">
                                <td className="py-2">
                                    <p className="text-slate-800">{it.name}</p>
                                    {it.description && <p className="text-xs text-slate-500">{it.description}</p>}
                                    {it.hsn && <p className="text-xs text-slate-400">HSN {it.hsn}</p>}
                                </td>
                                <td className="py-2 text-right">{it.quantity} {it.unit || ''}</td>
                                <td className="py-2 text-right">{inr(it.rate)}</td>
                                <td className="py-2 text-right">{it.taxRate}%</td>
                                <td className="py-2 text-right font-medium">{inr(it.total)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="space-y-3 sm:hidden">
                    {doc.items.map((it: any, i: number) => (
                        <div key={i} className="flex justify-between border-b border-slate-100 pb-2 text-sm">
                            <div>
                                <p className="text-slate-800">{it.name}</p>
                                <p className="text-xs text-slate-500">
                                    {it.quantity} {it.unit || ''} × {inr(it.rate)} · GST {it.taxRate}%
                                </p>
                            </div>
                            <p className="font-medium">{inr(it.total)}</p>
                        </div>
                    ))}
                </div>

                <div className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
                    {doc.invoice.discountAmount > 0 && <Row label="Discount" value={`-${inr(doc.invoice.discountAmount)}`} />}
                    <Row label="Taxable value" value={inr(t.taxable)} />
                    {t.cgst > 0 && <Row label="CGST" value={inr(t.cgst)} />}
                    {t.sgst > 0 && <Row label="SGST" value={inr(t.sgst)} />}
                    {t.igst > 0 && <Row label="IGST" value={inr(t.igst)} />}
                    {t.roundOff !== 0 && <Row label="Round off" value={inr(t.roundOff)} />}
                    <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
                        <span>Total</span>
                        <span>{inr(t.grandTotal)}</span>
                    </div>
                    {t.paid > 0 && <Row label="Paid" value={inr(t.paid)} />}
                    {t.paid > 0 && !paid && <Row label="Balance due" value={inr(t.balance)} bold />}
                </div>
                <p className="mt-3 text-xs text-slate-500">{doc.amountInWords}</p>
                {doc.invoice.notes && <p className="mt-2 text-sm text-slate-600">{doc.invoice.notes}</p>}
            </div>

            {/* Payment */}
            {!paid && !cancelled && (doc.upi || doc.company.bank) && (
                <div className="grid gap-5 border-t border-slate-200 bg-slate-50 p-5 sm:grid-cols-2">
                    {doc.upi && (
                        <div className="flex flex-col items-center text-center">
                            <p className="mb-2 text-sm font-semibold text-slate-700">Pay {inr(t.balance)} with any UPI app</p>
                            <a href={doc.upi.link} className="btn btn-primary mb-3 w-full justify-center sm:hidden">
                                <Smartphone className="h-4 w-4" /> Pay with UPI
                            </a>
                            <img src={doc.upi.qr} alt="UPI QR code" className="h-44 w-44 rounded-lg border border-slate-200 bg-white p-1" />
                            <p className="mt-1 text-xs text-slate-500">{doc.company.upi_id}</p>
                        </div>
                    )}
                    {doc.company.bank && (
                        <div className="text-sm text-slate-700">
                            <p className="mb-2 flex items-center gap-1 font-semibold">
                                <Landmark className="h-4 w-4" /> Bank transfer
                            </p>
                            {doc.company.bank.account_name && <p>A/c name: {doc.company.bank.account_name}</p>}
                            <p>A/c no: <span className="font-mono">{doc.company.bank.account_number}</span></p>
                            {doc.company.bank.ifsc && <p>IFSC: <span className="font-mono">{doc.company.bank.ifsc}</span></p>}
                            {doc.company.bank.name && <p>{doc.company.bank.name}{doc.company.bank.branch ? `, ${doc.company.bank.branch}` : ''}</p>}
                            <p className="mt-2 text-xs text-slate-500">Please mention {doc.invoice.number} as the payment reference.</p>
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

const StatementBody: React.FC<{ doc: any }> = ({ doc }) => {
    const s = doc.statement;
    return (
        <div className="p-5">
            <p className="mb-3 font-semibold text-slate-800">{s.ledger.name}</p>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                            <th className="py-2">Date</th>
                            <th className="py-2">Particulars</th>
                            <th className="py-2 text-right">Debit</th>
                            <th className="py-2 text-right">Credit</th>
                            <th className="py-2 text-right">Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="border-b border-slate-100 bg-slate-50">
                            <td className="py-2">{formatDate(s.period.from)}</td>
                            <td className="py-2 font-medium">Opening balance</td>
                            <td />
                            <td />
                            <td className="py-2 text-right">{inr(s.ledger.opening_balance)} {s.ledger.opening_balance_type}</td>
                        </tr>
                        {s.transactions.map((t: any) => (
                            <tr key={t.id} className="border-b border-slate-100">
                                <td className="py-2 whitespace-nowrap">{formatDate(t.date)}</td>
                                <td className="py-2">
                                    {t.voucher_type_name} {t.voucher_number}
                                    {t.narration && <span className="block text-xs text-slate-500">{t.narration}</span>}
                                </td>
                                <td className="py-2 text-right">{t.debit ? inr(t.debit) : ''}</td>
                                <td className="py-2 text-right">{t.credit ? inr(t.credit) : ''}</td>
                                <td className="py-2 text-right whitespace-nowrap">{inr(t.balance)} {t.balance_type}</td>
                            </tr>
                        ))}
                        <tr className="font-semibold">
                            <td className="py-2" />
                            <td className="py-2">Closing balance</td>
                            <td className="py-2 text-right">{inr(s.ledger.total_debit)}</td>
                            <td className="py-2 text-right">{inr(s.ledger.total_credit)}</td>
                            <td className="py-2 text-right">{inr(s.ledger.closing_balance)} {s.ledger.closing_balance_type}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const Row: React.FC<{ label: string; value: string; bold?: boolean }> = ({ label, value, bold }) => (
    <div className={`flex justify-between ${bold ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
        <span>{label}</span>
        <span>{value}</span>
    </div>
);
