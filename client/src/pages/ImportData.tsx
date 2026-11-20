import React, { useState } from 'react';
import { Upload, FileSpreadsheet, FileCode2, Download, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import api, { apiError } from '../api/axios';
import { useCompany } from '../context/CompanyContext';
import { notify } from '../utils/notification';
import { Button } from '../components/ui/Button';
import { fetchBlob, saveBlob } from '../lib/files';

type Kind = 'tally' | 'ledgers' | 'items';
interface Report {
    dryRun: boolean;
    created: Record<string, number>;
    updated: Record<string, number>;
    skipped: Record<string, number>;
    errors: { ref: string; message: string }[];
    warnings?: { ref: string; message: string }[];
}

const TABS: { kind: Kind; title: string; icon: React.ReactNode; help: React.ReactNode; accept: string }[] = [
    {
        kind: 'tally',
        title: 'From Tally',
        icon: <FileCode2 className="h-5 w-5" />,
        accept: '.xml,text/xml,application/xml',
        help: (
            <ol className="list-decimal space-y-1 pl-5">
                <li>In Tally: <b>Gateway of Tally → Display More Reports → List of Accounts</b>, press <b>Alt+E (Export)</b>, choose format <b>XML</b> and export. This brings groups, ledgers with opening balances and unpaid bills, GST tax ledgers, voucher types, units and stock items.</li>
                <li>For transactions: open <b>Day Book</b> for the period, press <b>Alt+E</b>, format <b>XML</b>. Sales and purchases become GST invoices with their items and stock, and receipts are matched to the bills they paid.</li>
                <li>Upload the masters file first, then the Day Book file. Re-uploading the same file never creates duplicates.</li>
                <li>After importing, compare the Trial Balance with Tally's for the same period: they should match exactly.</li>
            </ol>
        ),
    },
    {
        kind: 'ledgers',
        title: 'Parties & ledgers (Excel)',
        icon: <FileSpreadsheet className="h-5 w-5" />,
        accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        help: <p>Download the template, fill one party per row (name, group, GSTIN, phone, email, opening balance…) and upload it.</p>,
    },
    {
        kind: 'items',
        title: 'Items (Excel)',
        icon: <FileSpreadsheet className="h-5 w-5" />,
        accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        help: <p>Download the template, fill one item per row (HSN, unit, GST rate, rates, opening quantity) and upload it.</p>,
    },
];

const toBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(new Error('Could not read the file'));
        r.readAsDataURL(file);
    });

const Counts: React.FC<{ title: string; data: Record<string, number>; tone: string }> = ({ title, data, tone }) =>
    Object.keys(data).length ? (
        <div>
            <p className="text-xs font-semibold uppercase text-slate-500">{title}</p>
            <ul className={`text-sm ${tone}`}>
                {Object.entries(data).map(([k, v]) => (
                    <li key={k}>{v} {k}</li>
                ))}
            </ul>
        </div>
    ) : null;

/** Bring data in from Tally or Excel: preview first, then import. */
export const ImportData: React.FC = () => {
    const { selectedCompany, isCompanyAdmin } = useCompany();
    const [tab, setTab] = useState<Kind>('tally');
    const [file, setFile] = useState<File | null>(null);
    const [report, setReport] = useState<Report | null>(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const t = TABS.find((x) => x.kind === tab)!;
    const url = tab === 'tally' ? '/import/tally' : `/import/excel/${tab}`;

    const run = async (commit: boolean) => {
        if (!file || !selectedCompany) return;
        setBusy(true);
        try {
            const body = { companyId: selectedCompany.id, fileBase64: await toBase64(file), commit };
            if (tab === 'tally') {
                // Tally files can hold years of vouchers: run in the background and show progress
                const start = await api.post(url, { ...body, background: true });
                const jobId = start.data.data.jobId;
                setProgress({ done: 0, total: 0 });
                for (;;) {
                    await new Promise((r) => setTimeout(r, 1200));
                    const job = (await api.get(`/import/jobs/${jobId}`)).data.data;
                    setProgress({ done: job.done, total: job.total });
                    if (job.status === 'done') {
                        setReport(job.report);
                        break;
                    }
                    if (job.status === 'failed') throw new Error(job.error || 'Import failed');
                }
            } else {
                const res = await api.post(url, body);
                setReport(res.data.data);
            }
            if (commit) notify.success('Import finished');
        } catch (e) {
            notify.error(apiError(e, 'Import failed'));
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    const template = async () => {
        try {
            saveBlob(await fetchBlob(`/import/excel/${tab}/template`), `cloudledger-${tab}-template.xlsx`);
        } catch (e) {
            notify.error(apiError(e, 'Could not download the template'));
        }
    };

    if (!isCompanyAdmin) {
        return <div className="card py-10 text-center text-slate-500">Only company admins can import data.</div>;
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-800">Import data</h1>
                <p className="text-sm text-slate-500">Moving from Tally or a spreadsheet? Bring your masters and books into {selectedCompany?.name}.</p>
            </div>

            <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
                <div className="flex w-max gap-1 rounded-xl bg-slate-100 p-1">
                    {TABS.map((x) => (
                        <button
                            key={x.kind}
                            onClick={() => { setTab(x.kind); setFile(null); setReport(null); }}
                            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${tab === x.kind ? 'bg-white text-primary shadow' : 'text-slate-600'}`}
                        >
                            {x.icon} {x.title}
                        </button>
                    ))}
                </div>
            </div>

            <div className="card space-y-4">
                <div className="text-sm text-slate-600">{t.help}</div>
                <div className="flex flex-wrap items-center gap-2">
                    {tab !== 'tally' && (
                        <Button variant="secondary" onClick={template}>
                            <Download className="h-4 w-4" /> Download template
                        </Button>
                    )}
                    <label className="btn btn-secondary cursor-pointer">
                        <Upload className="h-4 w-4" /> {file ? file.name : 'Choose file'}
                        <input type="file" className="hidden" accept={t.accept} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />
                    </label>
                    <Button onClick={() => run(false)} disabled={!file} isLoading={busy && !report}>Preview</Button>
                    {report?.dryRun && (
                        <Button onClick={() => run(true)} isLoading={busy}>
                            <CheckCircle2 className="h-4 w-4" /> Import now
                        </Button>
                    )}
                </div>
                {progress && (
                    <div className="mt-4">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                                className="h-2 rounded-full bg-primary transition-all"
                                style={{ width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : '5%' }}
                            />
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                            {progress.total
                                ? `Reading vouchers: ${progress.done.toLocaleString('en-IN')} of ${progress.total.toLocaleString('en-IN')}`
                                : 'Reading masters…'}{' '}
                            You can keep this page open; large files take a few minutes.
                        </p>
                    </div>
                )}
            </div>

            {report && (
                <div className="card space-y-4">
                    <p className={`font-semibold ${report.dryRun ? 'text-slate-700' : 'text-green-700'}`}>
                        {report.dryRun ? 'Preview: nothing has been saved yet' : 'Import complete'}
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Counts title={report.dryRun ? 'Will create' : 'Created'} data={report.created} tone="text-green-700" />
                        <Counts title={report.dryRun ? 'Will update' : 'Updated'} data={report.updated} tone="text-blue-700" />
                        <Counts title="Skipped" data={report.skipped} tone="text-slate-500" />
                    </div>
                    {report.errors.length > 0 && (
                        <div className="rounded-lg bg-amber-50 p-3">
                            <p className="mb-1 flex items-center gap-1 text-sm font-semibold text-amber-800">
                                <AlertTriangle className="h-4 w-4" /> {report.errors.length} record{report.errors.length === 1 ? '' : 's'} need attention (these are not imported)
                            </p>
                            <ul className="max-h-64 overflow-y-auto text-sm text-amber-900">
                                {report.errors.map((e, i) => (
                                    <li key={i}><b>{e.ref}:</b> {e.message}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {!!report.warnings?.length && (
                        <div className="rounded-lg bg-sky-50 p-3">
                            <p className="mb-1 flex items-center gap-1 text-sm font-semibold text-sky-800">
                                <Info className="h-4 w-4" /> {report.warnings.length} record{report.warnings.length === 1 ? ' was' : 's were'} imported with a note (please review)
                            </p>
                            <ul className="max-h-64 overflow-y-auto text-sm text-sky-900">
                                {report.warnings.map((e, i) => (
                                    <li key={i}><b>{e.ref}:</b> {e.message}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
