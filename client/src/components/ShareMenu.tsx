import React, { useMemo, useState } from 'react';
import { Share2, MessageCircle, Mail, Link2, Download, Printer, Smartphone, X, Check, Loader2, Send } from 'lucide-react';
import api, { apiError } from '../api/axios';
import { notify } from '../utils/notification';
import { Button } from './ui/Button';
import { canShareFiles, fetchBlob, printBlob, saveBlob } from '../lib/files';

/** What is being shared. */
export type ShareTarget =
    | { kind: 'invoice'; id: string; label?: string }
    | { kind: 'statement'; ledgerId: string; startDate: string; endDate: string; label?: string };

interface ShareData {
    url: string;
    expiresAt: string;
    message: string;
    whatsappUrl: string;
    whatsappNumber: string | null;
    email: { to: string | null; subject: string; body: string };
    upiLink: string | null;
    fileName: string;
    party: { name: string; phone: string | null; email: string | null };
}

const endpoints = (t: ShareTarget) =>
    t.kind === 'invoice'
        ? {
              share: `/invoices/${t.id}/share`,
              log: `/invoices/${t.id}/share-log`,
              pdf: `/invoices/${t.id}/pdf`,
              email: `/invoices/${t.id}/email`,
              params: {},
          }
        : {
              share: `/ledgers/${t.ledgerId}/statement/share`,
              log: `/ledgers/${t.ledgerId}/statement/share-log`,
              pdf: `/ledgers/${t.ledgerId}/statement/pdf`,
              email: `/ledgers/${t.ledgerId}/statement/email`,
              params: { startDate: t.startDate, endDate: t.endDate },
          };

const normaliseIndianMobile = (phone: string) => {
    let d = phone.replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) d = `91${d}`;
    return d;
};

/**
 * One "Share" button for any document: WhatsApp, email, copy link, download,
 * print, and the phone's own share sheet (which attaches the actual PDF).
 */
export const ShareMenu: React.FC<{
    target: ShareTarget;
    variant?: 'primary' | 'secondary';
    compact?: boolean;
    /** 'icon' renders a small icon-only trigger for table rows. */
    appearance?: 'button' | 'icon';
}> = ({ target, variant = 'primary', compact, appearance = 'button' }) => {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<ShareData | null>(null);
    const [message, setMessage] = useState('');
    const [phone, setPhone] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [showEmail, setShowEmail] = useState(false);
    const [email, setEmail] = useState({ to: '', cc: '', subject: '' });
    const ep = useMemo(() => endpoints(target), [target]);
    const nativeFiles = useMemo(() => canShareFiles(), []);

    const log = (channel: string, recipient?: string | null) =>
        api.post(ep.log, { channel, recipient }).catch(() => undefined);

    const openMenu = async () => {
        setOpen(true);
        if (data) return;
        setLoading(true);
        try {
            const res = await api.post(ep.share, ep.params);
            const d: ShareData = res.data.data;
            setData(d);
            setMessage(d.message);
            setPhone(d.party.phone || '');
            setEmail({ to: d.email.to || '', cc: '', subject: d.email.subject });
        } catch (err) {
            notify.error(apiError(err, 'Could not create a share link'));
            setOpen(false);
        } finally {
            setLoading(false);
        }
    };

    const getPdf = () => fetchBlob(ep.pdf, ep.params);

    const whatsapp = () => {
        if (!data) return;
        const number = phone ? normaliseIndianMobile(phone) : '';
        window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
        log('WHATSAPP', number || null);
    };

    const copyLink = async () => {
        if (!data) return;
        try {
            await navigator.clipboard.writeText(data.url);
        } catch {
            window.prompt('Copy this link', data.url);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        log('LINK');
    };

    const download = async () => {
        setBusy('download');
        try {
            saveBlob(await getPdf(), data?.fileName || 'document.pdf');
            log('DOWNLOAD');
        } catch (err) {
            notify.error(apiError(err, 'Download failed'));
        } finally {
            setBusy(null);
        }
    };

    const print = async () => {
        setBusy('print');
        try {
            printBlob(await getPdf());
            log('PRINT');
        } catch (err) {
            notify.error(apiError(err, 'Could not open the print dialog'));
        } finally {
            setBusy(null);
        }
    };

    /** Phone share sheet: sends the PDF itself to WhatsApp, Gmail, Telegram, Drive… */
    const nativeShare = async () => {
        if (!data) return;
        setBusy('native');
        try {
            if (nativeFiles) {
                const blob = await getPdf();
                const file = new File([blob], data.fileName, { type: 'application/pdf' });
                await navigator.share({ files: [file], title: data.fileName, text: message });
            } else {
                await navigator.share({ title: data.fileName, text: message, url: data.url });
            }
            log('NATIVE');
        } catch (err: any) {
            if (err?.name !== 'AbortError') notify.error(apiError(err, 'Sharing was not completed'));
        } finally {
            setBusy(null);
        }
    };

    const sendEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy('email');
        try {
            await api.post(ep.email, { ...ep.params, to: email.to, cc: email.cc || undefined, subject: email.subject, message });
            notify.success(`Sent to ${email.to}`);
            setShowEmail(false);
        } catch (err) {
            notify.error(apiError(err, 'Email could not be sent'));
        } finally {
            setBusy(null);
        }
    };

    const action = (key: string, icon: React.ReactNode, label: string, onClick: () => void, className: string, hint?: string) => (
        <button
            type="button"
            onClick={onClick}
            disabled={!data || !!busy}
            className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-sm font-medium transition-colors disabled:opacity-50 ${className}`}
        >
            {busy === key ? <Loader2 className="h-6 w-6 animate-spin" /> : icon}
            <span>{label}</span>
            {hint && <span className="text-[11px] font-normal opacity-70">{hint}</span>}
        </button>
    );

    const hasNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    return (
        <>
            {appearance === 'icon' ? (
                <button type="button" onClick={openMenu} title="Share (WhatsApp, email, link)" className="p-1 text-slate-400 transition-colors hover:text-green-600">
                    <Share2 className="h-4 w-4" />
                </button>
            ) : (
                <Button type="button" variant={variant} onClick={openMenu} title="Share">
                    <Share2 className="h-4 w-4" />
                    {!compact && 'Share'}
                </Button>
            )}

            {open && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setOpen(false)}>
                    <div
                        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-label="Share"
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-bold text-slate-800">Share {target.label || (target.kind === 'invoice' ? 'invoice' : 'statement')}</h2>
                                {data?.party.name && <p className="text-sm text-slate-500">with {data.party.name}</p>}
                            </div>
                            <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
                                <Loader2 className="h-5 w-5 animate-spin" /> Preparing link…
                            </div>
                        ) : showEmail ? (
                            <form onSubmit={sendEmail} className="space-y-3">
                                <label className="block text-sm font-medium text-slate-700">
                                    To
                                    <input className="input-field mt-1" type="email" required value={email.to} onChange={(e) => setEmail({ ...email, to: e.target.value })} />
                                </label>
                                <label className="block text-sm font-medium text-slate-700">
                                    CC (optional)
                                    <input className="input-field mt-1" type="email" value={email.cc} onChange={(e) => setEmail({ ...email, cc: e.target.value })} />
                                </label>
                                <label className="block text-sm font-medium text-slate-700">
                                    Subject
                                    <input className="input-field mt-1" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} />
                                </label>
                                <label className="block text-sm font-medium text-slate-700">
                                    Message
                                    <textarea className="input-field mt-1 h-32" value={message} onChange={(e) => setMessage(e.target.value)} />
                                </label>
                                <p className="text-xs text-slate-500">The PDF is attached and the message includes the view link.</p>
                                <div className="flex justify-end gap-2">
                                    <Button type="button" variant="secondary" onClick={() => setShowEmail(false)}>Back</Button>
                                    <Button type="submit" isLoading={busy === 'email'}>
                                        <Send className="h-4 w-4" /> Send email
                                    </Button>
                                </div>
                            </form>
                        ) : (
                            <>
                                <div className="grid grid-cols-3 gap-2">
                                    {action('whatsapp', <MessageCircle className="h-6 w-6" />, 'WhatsApp', whatsapp, 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100')}
                                    {action('emailbtn', <Mail className="h-6 w-6" />, 'Email', () => setShowEmail(true), 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100')}
                                    {action('copy', copied ? <Check className="h-6 w-6" /> : <Link2 className="h-6 w-6" />, copied ? 'Copied!' : 'Copy link', copyLink, 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100')}
                                    {action('download', <Download className="h-6 w-6" />, 'Download', download, 'border-slate-200 hover:bg-slate-50 text-slate-700')}
                                    {action('print', <Printer className="h-6 w-6" />, 'Print', print, 'border-slate-200 hover:bg-slate-50 text-slate-700')}
                                    {hasNativeShare &&
                                        action('native', <Smartphone className="h-6 w-6" />, 'More apps', nativeShare, 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100', nativeFiles ? 'sends the PDF' : undefined)}
                                </div>

                                <div className="mt-5 space-y-3">
                                    <label className="block text-sm font-medium text-slate-700">
                                        WhatsApp number
                                        <input
                                            className="input-field mt-1"
                                            inputMode="tel"
                                            placeholder="10-digit mobile number"
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                        />
                                        {!phone && <span className="mt-1 block text-xs text-slate-500">Leave empty to pick a contact in WhatsApp. Save the party’s phone in Ledgers to fill this automatically.</span>}
                                    </label>
                                    <label className="block text-sm font-medium text-slate-700">
                                        Message
                                        <textarea className="input-field mt-1 h-36 text-sm" value={message} onChange={(e) => setMessage(e.target.value)} />
                                    </label>
                                    {data && (
                                        <p className="text-xs text-slate-500">
                                            Anyone with the link can view and download this document until{' '}
                                            {new Date(data.expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.
                                        </p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};
