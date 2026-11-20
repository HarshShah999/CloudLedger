import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Trash2, Upload, Palette } from 'lucide-react';
import api, { apiError } from '../api/axios';
import { useCompany } from '../context/CompanyContext';
import { notify } from '../utils/notification';
import { Button } from './ui/Button';
import { imageToDataUrl } from '../lib/files';

type Kind = 'logo' | 'signature';

/** Upload slot for one company image with preview. */
const ImageSlot: React.FC<{ kind: Kind; title: string; hint: string; disabled: boolean; exists: boolean }> = ({ kind, title, hint, disabled, exists }) => {
    const { selectedCompany } = useCompany();
    const [src, setSrc] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const base = `/companies/${selectedCompany?.id}/assets/${kind}`;

    const load = () =>
        api
            .get(base, { responseType: 'blob' })
            .then((r) => setSrc(URL.createObjectURL(r.data)))
            .catch(() => setSrc(null));

    useEffect(() => {
        if (selectedCompany && exists) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCompany?.id, exists]);

    const upload = async (file?: File) => {
        if (!file) return;
        setBusy(true);
        try {
            const dataUrl = await imageToDataUrl(file, kind === 'logo' ? 600 : 800);
            await api.put(base, { dataUrl });
            notify.success(`${title} updated`);
            load();
        } catch (err) {
            notify.error(apiError(err, `Could not upload the ${kind}`));
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        setBusy(true);
        try {
            await api.delete(base);
            setSrc(null);
        } catch (err) {
            notify.error(apiError(err, 'Could not remove the image'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-xl border border-slate-200 p-4">
            <p className="font-medium text-slate-700">{title}</p>
            <p className="mb-3 text-xs text-slate-500">{hint}</p>
            <div className="mb-3 flex h-24 items-center justify-center rounded-lg bg-slate-50">
                {src ? <img src={src} alt={title} className="max-h-20 max-w-full object-contain" /> : <ImageIcon className="h-8 w-8 text-slate-300" />}
            </div>
            {!disabled && (
                <div className="flex gap-2">
                    <label className={`btn btn-secondary flex-1 cursor-pointer justify-center ${busy ? 'opacity-60' : ''}`}>
                        <Upload className="h-4 w-4" /> {src ? 'Replace' : 'Upload'}
                        <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
                    </label>
                    {src && (
                        <Button type="button" variant="secondary" onClick={remove} disabled={busy} title="Remove">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
};

/** Logo, signature, brand colour and copy labels used on invoice PDFs. */
export const BrandingSettings: React.FC = () => {
    const { selectedCompany, isCompanyAdmin } = useCompany();
    const [color, setColor] = useState('#4338CA');
    const [copyLabels, setCopyLabels] = useState(true);
    const [saving, setSaving] = useState(false);
    const [has, setHas] = useState({ logo: false, signature: false });

    useEffect(() => {
        if (!selectedCompany) return;
        api.get(`/companies/${selectedCompany.id}`).then((r) => {
            setColor(r.data.data.company.brand_color || '#4338CA');
            setCopyLabels(r.data.data.company.print_copy_labels ?? true);
            setHas({ logo: !!r.data.data.company.has_logo, signature: !!r.data.data.company.has_signature });
        });
    }, [selectedCompany?.id]);

    const save = async () => {
        if (!selectedCompany) return;
        setSaving(true);
        try {
            await api.put(`/companies/${selectedCompany.id}`, { brandColor: color, printCopyLabels: copyLabels });
            notify.success('Invoice design saved');
        } catch (err) {
            notify.error(apiError(err, 'Could not save'));
        } finally {
            setSaving(false);
        }
    };

    if (!selectedCompany) return null;
    return (
        <div className="card space-y-5">
            <div className="flex items-center gap-3">
                <Palette className="h-6 w-6 text-primary" />
                <div>
                    <h3 className="text-lg font-bold text-slate-800">Invoice Design</h3>
                    <p className="text-sm text-slate-500">Your logo, signature and colour on every PDF and shared link.</p>
                </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ImageSlot kind="logo" title="Logo" hint="PNG with transparent background works best." disabled={!isCompanyAdmin} exists={has.logo} />
                <ImageSlot kind="signature" title="Signature / stamp" hint="Printed above “Authorised Signatory”." disabled={!isCompanyAdmin} exists={has.signature} />
            </div>
            <fieldset disabled={!isCompanyAdmin} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-3">
                    <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
                        Brand colour
                        <input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} className="h-9 w-14 cursor-pointer rounded border border-slate-200" />
                        <span className="font-mono text-xs text-slate-500">{color}</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={copyLabels} onChange={(e) => setCopyLabels(e.target.checked)} />
                        Print “Original for Recipient / Duplicate / Triplicate” on tax invoices
                    </label>
                </div>
                {isCompanyAdmin && (
                    <Button type="button" onClick={save} isLoading={saving}>
                        Save design
                    </Button>
                )}
            </fieldset>
        </div>
    );
};
