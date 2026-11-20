import React, { useEffect, useState } from 'react';
import { BellRing, Send } from 'lucide-react';
import api, { apiError } from '../api/axios';
import { useCompany } from '../context/CompanyContext';
import { notify } from '../utils/notification';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { formatDate } from '../lib/dates';

/** Automatic payment reminders by email and WhatsApp (Business Cloud API). */
export const ReminderSettings: React.FC = () => {
    const { selectedCompany, isCompanyAdmin } = useCompany();
    const [form, setForm] = useState({
        remindersEnabled: false, reminderDays: '-3,0,7,15,30', email: true, whatsapp: false,
        whatsappPhoneNumberId: '', whatsappToken: '', whatsappTemplate: '', whatsappTemplateLang: 'en',
    });
    const [hasToken, setHasToken] = useState(false);
    const [saving, setSaving] = useState(false);
    const [preview, setPreview] = useState<{ due: any[]; history: any[] } | null>(null);

    const loadPreview = () =>
        selectedCompany && api.get('/reminders', { params: { companyId: selectedCompany.id } }).then((r) => setPreview(r.data.data)).catch(() => undefined);

    useEffect(() => {
        if (!selectedCompany) return;
        api.get(`/companies/${selectedCompany.id}`).then((r) => {
            const c = r.data.data.company;
            const ch = String(c.reminder_channels || 'EMAIL');
            setForm({
                remindersEnabled: !!c.reminders_enabled, reminderDays: c.reminder_days || '-3,0,7,15,30',
                email: ch.includes('EMAIL'), whatsapp: ch.includes('WHATSAPP'),
                whatsappPhoneNumberId: c.whatsapp_phone_number_id || '', whatsappToken: '',
                whatsappTemplate: c.whatsapp_template || '', whatsappTemplateLang: c.whatsapp_template_lang || 'en',
            });
            setHasToken(!!c.has_whatsapp_token);
        });
        loadPreview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCompany?.id]);

    const save = async () => {
        if (!selectedCompany) return;
        const channels = [form.email && 'EMAIL', form.whatsapp && 'WHATSAPP'].filter(Boolean).join(',') || 'EMAIL';
        setSaving(true);
        try {
            const body: Record<string, unknown> = {
                remindersEnabled: form.remindersEnabled, reminderDays: form.reminderDays.replace(/\s/g, ''), reminderChannels: channels,
                whatsappPhoneNumberId: form.whatsappPhoneNumberId, whatsappTemplate: form.whatsappTemplate, whatsappTemplateLang: form.whatsappTemplateLang,
            };
            if (form.whatsappToken) body.whatsappToken = form.whatsappToken;
            const r = await api.put(`/companies/${selectedCompany.id}`, body);
            setHasToken(!!r.data.data.company.has_whatsapp_token);
            setForm((f) => ({ ...f, whatsappToken: '' }));
            notify.success('Reminder settings saved');
            loadPreview();
        } catch (err) {
            notify.error(apiError(err, 'Could not save'));
        } finally {
            setSaving(false);
        }
    };

    const sendNow = async () => {
        if (!selectedCompany) return;
        try {
            const r = await api.post('/reminders/send', { companyId: selectedCompany.id });
            notify.success(`Sent ${r.data.data.sent}, failed ${r.data.data.failed}, skipped ${r.data.data.skipped}`);
            loadPreview();
        } catch (err) {
            notify.error(apiError(err, 'Could not send reminders'));
        }
    };

    if (!selectedCompany) return null;
    return (
        <div className="card space-y-5">
            <div className="flex items-center gap-3">
                <BellRing className="h-6 w-6 text-primary" />
                <div>
                    <h3 className="text-lg font-bold text-slate-800">Automatic payment reminders</h3>
                    <p className="text-sm text-slate-500">Customers with unpaid invoices get a polite reminder with the invoice link and PDF, every day at 10 am on the days you choose.</p>
                </div>
            </div>
            <fieldset disabled={!isCompanyAdmin} className="space-y-4">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={form.remindersEnabled} onChange={(e) => setForm({ ...form, remindersEnabled: e.target.checked })} />
                    Send reminders automatically
                </label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <Input label="Days relative to the due date" value={form.reminderDays} onChange={(e) => setForm({ ...form, reminderDays: e.target.value })} />
                        <p className="mt-1 text-xs text-slate-500">-3 = three days before, 0 = on the due date, 7 = a week after.</p>
                    </div>
                    <div className="space-y-2 text-sm text-slate-700">
                        <p className="font-medium">Send by</p>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={form.email} onChange={(e) => setForm({ ...form, email: e.target.checked })} /> Email (uses the party’s email)</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })} /> WhatsApp (Business Cloud API)</label>
                    </div>
                </div>
                {form.whatsapp && (
                    <div className="space-y-3 rounded-xl bg-slate-50 p-4">
                        <p className="text-xs text-slate-600">
                            Needs a WhatsApp Business account on Meta. Create a <b>utility</b> message template with 5 body variables in this order:
                            {' '}{'{{1}}'} customer name, {'{{2}}'} invoice no., {'{{3}}'} amount, {'{{4}}'} due date, {'{{5}}'} link, and get it approved.
                            Meta charges per message.
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Input label="Phone number ID" value={form.whatsappPhoneNumberId} onChange={(e) => setForm({ ...form, whatsappPhoneNumberId: e.target.value })} />
                            <Input
                                label={hasToken ? 'Access token (saved – type to replace)' : 'Access token'}
                                type="password"
                                autoComplete="off"
                                value={form.whatsappToken}
                                onChange={(e) => setForm({ ...form, whatsappToken: e.target.value })}
                            />
                            <Input label="Template name" value={form.whatsappTemplate} onChange={(e) => setForm({ ...form, whatsappTemplate: e.target.value })} />
                            <Input label="Template language" value={form.whatsappTemplateLang} onChange={(e) => setForm({ ...form, whatsappTemplateLang: e.target.value })} />
                        </div>
                    </div>
                )}
            </fieldset>
            {isCompanyAdmin && (
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={sendNow}><Send className="h-4 w-4" /> Send today’s reminders now</Button>
                    <Button onClick={save} isLoading={saving}>Save reminder settings</Button>
                </div>
            )}

            {preview && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                        <p className="mb-2 text-sm font-semibold text-slate-700">Due for a reminder today ({preview.due.length})</p>
                        <ul className="space-y-1 text-sm text-slate-600">
                            {preview.due.length === 0 && <li className="text-slate-400">None</li>}
                            {preview.due.map((d) => (
                                <li key={d.invoiceId}>
                                    {d.number} · {d.party} · ₹{d.outstanding.toLocaleString('en-IN')}{' '}
                                    {d.channels.filter((c: any) => !c.ready).map((c: any) => (
                                        <span key={c.channel} className="text-xs text-amber-600">(no {c.channel === 'EMAIL' ? 'email' : 'WhatsApp'}) </span>
                                    ))}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <p className="mb-2 text-sm font-semibold text-slate-700">Recently sent</p>
                        <ul className="space-y-1 text-sm text-slate-600">
                            {preview.history.length === 0 && <li className="text-slate-400">Nothing yet</li>}
                            {preview.history.slice(0, 8).map((h) => (
                                <li key={h.id}>
                                    {formatDate(String(h.created_at).slice(0, 10))} · {h.invoice_number} · {h.channel}{' '}
                                    <span className={h.status === 'SENT' ? 'text-green-700' : h.status === 'FAILED' ? 'text-red-600' : 'text-slate-400'} title={h.detail || ''}>
                                        {h.status.toLowerCase()}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
};
