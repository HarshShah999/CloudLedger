import React, { useEffect, useState } from 'react';
import { FileCheck2, Truck, Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
import api, { apiError } from '../api/axios';
import { notify } from '../utils/notification';
import { Button } from './ui/Button';
import { fetchBlob, saveBlob } from '../lib/files';
import { formatDateTime } from '../lib/format';

/**
 * E-invoice (IRN) and e-way bill for one invoice: shows what is missing,
 * downloads the upload JSON, and records the IRN / EWB number you get back.
 */
export const EDocsPanel: React.FC<{ invoice: any; canWrite: boolean; onChange: () => void }> = ({ invoice, canWrite, onChange }) => {
    const [ein, setEin] = useState<any>(null);
    const [ewb, setEwb] = useState<any>(null);
    const [irnForm, setIrnForm] = useState({ irn: '', ackNo: '', ackDate: '', signedQr: '' });
    const [ewbForm, setEwbForm] = useState({ ewbNumber: '', ewbDate: '', validUntil: '' });
    const [showIrn, setShowIrn] = useState(false);
    const [showEwb, setShowEwb] = useState(false);

    useEffect(() => {
        api.get(`/invoices/${invoice.id}/einvoice`).then((r) => setEin(r.data.data)).catch(() => setEin(null));
        if (invoice.type === 'SALES') api.get(`/invoices/${invoice.id}/ewaybill`).then((r) => setEwb(r.data.data)).catch(() => setEwb(null));
    }, [invoice.id, invoice.irn, invoice.ewb_number, invoice.type]);

    const download = async (path: string, name: string) => {
        try {
            saveBlob(await fetchBlob(path, { download: 1 }), name);
        } catch (e) {
            notify.error(apiError(e, 'Could not create the file'));
        }
    };

    const save = async (path: string, body: object, done: () => void) => {
        try {
            await api.post(path, body);
            notify.success('Saved');
            done();
            onChange();
        } catch (e) {
            notify.error(apiError(e, 'Could not save'));
        }
    };

    const eInvApplicable = ein && !ein.problems.some((p: string) => p.startsWith('E-invoice applies only'));
    const ewbApplicable = ewb && ewb.required;
    if (!eInvApplicable && !ewbApplicable && !invoice.irn && !invoice.ewb_number) return null;
    const safe = invoice.invoice_number.replace(/[^A-Za-z0-9._-]+/g, '-');

    return (
        <div className="card grid grid-cols-1 gap-6 md:grid-cols-2">
            {(eInvApplicable || invoice.irn) && (
                <div className="space-y-3">
                    <h3 className="flex items-center gap-2 font-semibold text-slate-700"><FileCheck2 className="h-5 w-5" /> E-invoice</h3>
                    {invoice.irn ? (
                        <div className="text-sm">
                            <p className={invoice.irn_status === 'CANCELLED' ? 'text-red-600' : 'text-green-700'}>
                                <CheckCircle2 className="mr-1 inline h-4 w-4" /> IRN {invoice.irn_status === 'CANCELLED' ? 'cancelled' : 'generated'}
                            </p>
                            <p className="break-all font-mono text-xs text-slate-500">{invoice.irn}</p>
                            <p className="text-xs text-slate-500">Ack {invoice.irn_ack_no}</p>
                            {canWrite && invoice.irn_status === 'ACTIVE' && (
                                <button
                                    className="mt-2 text-xs text-red-600 hover:underline"
                                    onClick={() => confirm('Mark the IRN as cancelled? Do this only after cancelling it on the IRP (allowed within 24 hours).') && save(`/invoices/${invoice.id}/irn/cancel`, {}, () => undefined)}
                                >
                                    Mark IRN as cancelled
                                </button>
                            )}
                        </div>
                    ) : (
                        <>
                            {ein.problems.length > 0 ? (
                                <ul className="space-y-1 text-sm text-amber-700">
                                    {ein.problems.map((p: string) => <li key={p}><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{p}</li>)}
                                </ul>
                            ) : (
                                <p className="text-sm text-slate-600">Ready. Upload the JSON on the IRP (einvoice1.gst.gov.in → Bulk upload) or via your GSP, then save the IRN here.</p>
                            )}
                            <div className="flex flex-wrap gap-2">
                                <Button variant="secondary" disabled={ein.problems.length > 0} onClick={() => download(`/invoices/${invoice.id}/einvoice`, `einvoice-${safe}.json`)}>
                                    <Download className="h-4 w-4" /> E-invoice JSON
                                </Button>
                                {canWrite && <Button variant="secondary" onClick={() => setShowIrn(!showIrn)}>Enter IRN</Button>}
                            </div>
                            {showIrn && (
                                <div className="space-y-2">
                                    <input className="input-field font-mono text-xs" placeholder="IRN (64 characters)" value={irnForm.irn} onChange={(e) => setIrnForm({ ...irnForm, irn: e.target.value.trim() })} />
                                    <div className="grid grid-cols-2 gap-2">
                                        <input className="input-field" placeholder="Ack No." value={irnForm.ackNo} onChange={(e) => setIrnForm({ ...irnForm, ackNo: e.target.value })} />
                                        <input className="input-field" type="datetime-local" value={irnForm.ackDate} onChange={(e) => setIrnForm({ ...irnForm, ackDate: e.target.value })} />
                                    </div>
                                    <textarea className="input-field h-20 font-mono text-xs" placeholder="Signed QR code (from the IRP response)" value={irnForm.signedQr} onChange={(e) => setIrnForm({ ...irnForm, signedQr: e.target.value.trim() })} />
                                    <Button onClick={() => save(`/invoices/${invoice.id}/irn`, irnForm, () => setShowIrn(false))}>Save IRN</Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {(ewbApplicable || invoice.ewb_number) && (
                <div className="space-y-3">
                    <h3 className="flex items-center gap-2 font-semibold text-slate-700"><Truck className="h-5 w-5" /> E-way bill</h3>
                    {invoice.ewb_number ? (
                        <div className="text-sm">
                            <p className="text-green-700"><CheckCircle2 className="mr-1 inline h-4 w-4" /> EWB {invoice.ewb_number}</p>
                            {invoice.ewb_valid_until && <p className="text-xs text-slate-500">Valid until {formatDateTime(invoice.ewb_valid_until)}</p>}
                        </div>
                    ) : (
                        <>
                            <p className="text-sm text-slate-600">Goods worth ₹{Number(ewb.goodsValue).toLocaleString('en-IN')} — an e-way bill is required before the goods move.</p>
                            {ewb.problems.length > 0 && (
                                <ul className="space-y-1 text-sm text-amber-700">
                                    {ewb.problems.map((p: string) => <li key={p}><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{p}</li>)}
                                </ul>
                            )}
                            <div className="flex flex-wrap gap-2">
                                <Button variant="secondary" disabled={ewb.problems.length > 0} onClick={() => download(`/invoices/${invoice.id}/ewaybill`, `ewaybill-${safe}.json`)}>
                                    <Download className="h-4 w-4" /> E-way bill JSON
                                </Button>
                                {canWrite && <Button variant="secondary" onClick={() => setShowEwb(!showEwb)}>Enter EWB no.</Button>}
                            </div>
                            {showEwb && (
                                <div className="space-y-2">
                                    <input className="input-field" placeholder="12-digit e-way bill number" value={ewbForm.ewbNumber} onChange={(e) => setEwbForm({ ...ewbForm, ewbNumber: e.target.value.replace(/\D/g, '') })} />
                                    <div className="grid grid-cols-2 gap-2">
                                        <label className="text-xs text-slate-500">Generated<input className="input-field" type="datetime-local" value={ewbForm.ewbDate} onChange={(e) => setEwbForm({ ...ewbForm, ewbDate: e.target.value })} /></label>
                                        <label className="text-xs text-slate-500">Valid until<input className="input-field" type="datetime-local" value={ewbForm.validUntil} onChange={(e) => setEwbForm({ ...ewbForm, validUntil: e.target.value })} /></label>
                                    </div>
                                    <Button onClick={() => save(`/invoices/${invoice.id}/ewaybill`, ewbForm, () => setShowEwb(false))}>Save e-way bill</Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
