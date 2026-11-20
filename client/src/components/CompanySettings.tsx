import React, { useEffect, useState } from 'react';
import { Building2, Save } from 'lucide-react';
import api, { apiError } from '../api/axios';
import { useCompany } from '../context/CompanyContext';
import { notify } from '../utils/notification';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

const DEFAULT_TEMPLATE =
    'Dear {party},\n\nPlease find {doc} {number} dated {date} for {amount}.\n{due}\nView / download: {link}\n{upi}\nThank you,\n{company}';

const empty = {
    name: '', address: '', phone: '', email: '', gstin: '', pan: '', state: '', website: '',
    upiId: '', bankName: '', bankAccountName: '', bankAccountNumber: '', bankIfsc: '', bankBranch: '',
    invoiceTerms: '', shareMessageTemplate: '', shareLinkDays: 30, roundOffInvoices: true,
    city: '', pincode: '', einvoiceEnabled: false,
};

/** Company profile printed on invoices, plus payment details and sharing preferences. */
export const CompanySettings: React.FC = () => {
    const { selectedCompany, isCompanyAdmin, refreshCompanies } = useCompany();
    const [form, setForm] = useState(empty);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!selectedCompany) return;
        api.get(`/companies/${selectedCompany.id}`).then((res) => {
            const c = res.data.data.company;
            setForm({
                name: c.name || '', address: c.address || '', phone: c.phone || '', email: c.email || '',
                gstin: c.gstin || '', pan: c.pan || '', state: c.state || '', website: c.website || '',
                upiId: c.upi_id || '', bankName: c.bank_name || '', bankAccountName: c.bank_account_name || '',
                bankAccountNumber: c.bank_account_number || '', bankIfsc: c.bank_ifsc || '', bankBranch: c.bank_branch || '',
                invoiceTerms: c.invoice_terms || '', shareMessageTemplate: c.share_message_template || '',
                shareLinkDays: c.share_link_days || 30, roundOffInvoices: c.round_off_invoices ?? true,
                city: c.city || '', pincode: c.pincode || '', einvoiceEnabled: !!c.einvoice_enabled,
            });
        });
    }, [selectedCompany?.id]);

    const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm({ ...form, [k]: e.target.value });

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany) return;
        setSaving(true);
        try {
            await api.put(`/companies/${selectedCompany.id}`, { ...form, shareLinkDays: Number(form.shareLinkDays) });
            notify.success('Company settings saved');
            refreshCompanies();
        } catch (err) {
            notify.error(apiError(err, 'Could not save settings'));
        } finally {
            setSaving(false);
        }
    };

    if (!selectedCompany) return null;
    const disabled = !isCompanyAdmin;

    return (
        <form onSubmit={save} className="card space-y-6">
            <div className="flex items-center gap-3">
                <Building2 className="h-6 w-6 text-primary" />
                <div>
                    <h3 className="text-lg font-bold text-slate-800">Company & Invoice Settings</h3>
                    <p className="text-sm text-slate-500">
                        Printed on every invoice and used when you share by WhatsApp or email.
                        {disabled && ' Only company admins can change these.'}
                    </p>
                </div>
            </div>

            <fieldset disabled={disabled} className="space-y-6">
                <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Input label="Business Name" value={form.name} onChange={set('name')} required />
                    <Input label="State" value={form.state} onChange={set('state')} required />
                    <div className="md:col-span-2">
                        <Input label="Address" value={form.address} onChange={set('address')} />
                    </div>
                    <Input label="City" value={form.city} onChange={set('city')} />
                    <Input label="PIN code" inputMode="numeric" maxLength={6} value={form.pincode} onChange={set('pincode')} />
                    <Input label="GSTIN" value={form.gstin} maxLength={15} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
                    <Input label="PAN" value={form.pan} maxLength={10} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} />
                    <Input label="Phone" value={form.phone} onChange={set('phone')} />
                    <Input label="Email" type="email" value={form.email} onChange={set('email')} />
                    <Input label="Website" value={form.website} onChange={set('website')} />
                </section>

                <section>
                    <h4 className="mb-3 font-semibold text-slate-700">Getting paid</h4>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="md:col-span-2">
                            <Input label="UPI ID" placeholder="yourbusiness@okhdfcbank" value={form.upiId} onChange={set('upiId')} />
                            <p className="mt-1 text-xs text-slate-500">
                                Adds a scan-to-pay QR code to invoices and a “Pay with UPI” button on shared links.
                            </p>
                        </div>
                        <Input label="Account Holder Name" value={form.bankAccountName} onChange={set('bankAccountName')} />
                        <Input label="Bank Name" value={form.bankName} onChange={set('bankName')} />
                        <Input label="Account Number" value={form.bankAccountNumber} onChange={set('bankAccountNumber')} />
                        <Input label="IFSC" value={form.bankIfsc} maxLength={11} onChange={(e) => setForm({ ...form, bankIfsc: e.target.value.toUpperCase() })} />
                        <Input label="Branch" value={form.bankBranch} onChange={set('bankBranch')} />
                    </div>
                </section>

                <section className="space-y-4">
                    <h4 className="font-semibold text-slate-700">Invoices & sharing</h4>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                            type="checkbox"
                            checked={form.roundOffInvoices}
                            onChange={(e) => setForm({ ...form, roundOffInvoices: e.target.checked })}
                        />
                        Round invoice totals to the nearest rupee
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={form.einvoiceEnabled} onChange={(e) => setForm({ ...form, einvoiceEnabled: e.target.checked })} />
                        E-invoicing applies to us (aggregate turnover above the notified limit, currently ₹5 crore)
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                        Terms & conditions (one per line)
                        <textarea className="input-field mt-1 h-24" value={form.invoiceTerms} onChange={set('invoiceTerms')} placeholder="Goods once sold will not be taken back." />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                        WhatsApp / email message
                        <textarea
                            className="input-field mt-1 h-40 font-mono text-xs"
                            value={form.shareMessageTemplate || DEFAULT_TEMPLATE}
                            onChange={set('shareMessageTemplate')}
                        />
                        <span className="mt-1 block text-xs font-normal text-slate-500">
                            Placeholders: {'{party} {doc} {number} {date} {amount} {balance} {due} {link} {upi} {company}'}
                        </span>
                    </label>
                    <div className="max-w-xs">
                        <Input label="Shared links stay valid for (days)" type="number" min={1} max={365} value={form.shareLinkDays} onChange={set('shareLinkDays')} />
                    </div>
                </section>
            </fieldset>

            {!disabled && (
                <div className="flex justify-end">
                    <Button type="submit" isLoading={saving}>
                        <Save className="h-4 w-4" /> Save Company Settings
                    </Button>
                </div>
            )}
        </form>
    );
};
