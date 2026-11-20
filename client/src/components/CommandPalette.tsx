import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, Keyboard } from 'lucide-react';
import api from '../api/axios';
import { useCompany } from '../context/CompanyContext';
import { DOC_TYPES } from '../lib/docTypes';

interface Command {
    id: string;
    label: string;
    hint?: string;
    group: string;
    to: string;
}

/** Keyboard shortcuts (Alt + key), Tally-style. */
export const SHORTCUTS: { keys: string; label: string; to: string }[] = [
    { keys: 'Alt+S', label: 'New sales invoice', to: '/invoices/create/sales' },
    { keys: 'Alt+P', label: 'New purchase bill', to: '/invoices/create/purchase' },
    { keys: 'Alt+Q', label: 'New quotation', to: '/invoices/create/quotation' },
    { keys: 'Alt+R', label: 'Receive / pay money', to: '/receipts' },
    { keys: 'Alt+J', label: 'New voucher (journal, contra…)', to: '/vouchers/create' },
    { keys: 'Alt+L', label: 'Ledgers & parties', to: '/ledgers' },
    { keys: 'Alt+I', label: 'Items', to: '/inventory/items' },
    { keys: 'Alt+O', label: 'Outstanding', to: '/reports/outstanding' },
    { keys: 'Alt+D', label: 'Day Book', to: '/reports/day-book' },
    { keys: 'Alt+B', label: 'Balance Sheet', to: '/reports/balance-sheet' },
    { keys: 'Alt+T', label: 'Trial Balance', to: '/reports' },
    { keys: 'Alt+G', label: 'GSTR-1', to: '/reports/gstr-1' },
];

const PAGES: Command[] = [
    { id: 'p-home', label: 'Dashboard', group: 'Go to', to: '/' },
    ...DOC_TYPES.map((d) => ({ id: `p-list-${d.slug}`, label: d.plural, group: 'Go to', to: `/invoices?type=${d.type}` })),
    ...DOC_TYPES.map((d) => ({ id: `p-new-${d.slug}`, label: `New ${d.label}`, group: 'Create', to: `/invoices/create/${d.slug}` })),
    { id: 'p-receipts', label: 'Receipts & Payments', group: 'Go to', to: '/receipts' },
    { id: 'p-vouchers', label: 'Vouchers', group: 'Go to', to: '/vouchers' },
    { id: 'p-new-voucher', label: 'New Voucher', group: 'Create', to: '/vouchers/create' },
    { id: 'p-ledgers', label: 'Ledgers & parties', group: 'Go to', to: '/ledgers' },
    { id: 'p-items', label: 'Items', group: 'Go to', to: '/inventory/items' },
    { id: 'p-outstanding', label: 'Outstanding (ageing)', group: 'Reports', to: '/reports/outstanding' },
    { id: 'p-daybook', label: 'Day Book', group: 'Reports', to: '/reports/day-book' },
    { id: 'p-cashbank', label: 'Cash / Bank Book', group: 'Reports', to: '/reports/cash-bank-book' },
    { id: 'p-tb', label: 'Trial Balance', group: 'Reports', to: '/reports' },
    { id: 'p-pl', label: 'Profit & Loss', group: 'Reports', to: '/reports/profit-loss' },
    { id: 'p-bs', label: 'Balance Sheet', group: 'Reports', to: '/reports/balance-sheet' },
    { id: 'p-gstr1', label: 'GSTR-1', group: 'GST', to: '/reports/gstr-1' },
    { id: 'p-gstr3b', label: 'GSTR-3B', group: 'GST', to: '/reports/gstr-3b' },
    { id: 'p-gstr2b', label: 'GSTR-2B matching', group: 'GST', to: '/reports/gstr-2b' },
    { id: 'p-tds', label: 'TDS Register', group: 'GST', to: '/reports/tds' },
    { id: 'p-import', label: 'Import from Tally / Excel', group: 'Tools', to: '/import' },
    { id: 'p-audit', label: 'Audit Trail', group: 'Tools', to: '/audit' },
    { id: 'p-settings', label: 'Settings', group: 'Tools', to: '/settings' },
    { id: 'p-users', label: 'Users', group: 'Tools', to: '/users' },
];

const isTyping = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

/**
 * Ctrl+K / ⌘K opens a search box for pages, parties and invoices. Alt+key
 * shortcuts jump straight to common screens; "?" shows the list.
 */
export const CommandPalette: React.FC = () => {
    const navigate = useNavigate();
    const { selectedCompany } = useCompany();
    const [open, setOpen] = useState(false);
    const [help, setHelp] = useState(false);
    const [q, setQ] = useState('');
    const [active, setActive] = useState(0);
    const [data, setData] = useState<Command[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setOpen((o) => !o);
                return;
            }
            if (e.key === 'Escape') {
                setOpen(false);
                setHelp(false);
                return;
            }
            if (e.altKey && !e.ctrlKey && !e.metaKey) {
                const s = SHORTCUTS.find((x) => x.keys === `Alt+${e.key.toUpperCase()}` || x.keys === `Alt+${e.code.replace('Key', '')}`);
                if (s) {
                    e.preventDefault();
                    setOpen(false);
                    navigate(s.to);
                }
                return;
            }
            if (e.key === '?' && !isTyping(e)) setHelp((h) => !h);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [navigate]);

    // Load parties and recent documents when the palette opens
    useEffect(() => {
        if (!open || !selectedCompany) return;
        setQ('');
        setActive(0);
        setTimeout(() => inputRef.current?.focus(), 0);
        Promise.all([
            api.get('/ledgers', { params: { companyId: selectedCompany.id } }),
            api.get('/invoices', { params: { companyId: selectedCompany.id } }),
        ])
            .then(([l, i]) =>
                setData([
                    ...l.data.data.ledgers.map((x: any) => ({ id: `l-${x.id}`, label: x.name, hint: x.group_name, group: 'Ledgers', to: `/ledgers/${x.id}/statement` })),
                    ...i.data.data.invoices.slice(0, 300).map((x: any) => ({
                        id: `i-${x.id}`, label: x.invoice_number, hint: `${x.party_name} · ₹${Number(x.grand_total).toLocaleString('en-IN')}`, group: 'Documents', to: `/invoices/${x.id}`,
                    })),
                ])
            )
            .catch(() => undefined);
    }, [open, selectedCompany?.id]);

    const results = useMemo(() => {
        const all = [...PAGES, ...data];
        const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
        const hit = (c: Command) => terms.every((t) => `${c.label} ${c.hint || ''} ${c.group}`.toLowerCase().includes(t));
        return (terms.length ? all.filter(hit) : PAGES).slice(0, 40);
    }, [q, data]);

    const go = (c?: Command) => {
        if (!c) return;
        setOpen(false);
        navigate(c.to);
    };

    return (
        <>
            {open && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
                    <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
                        <div className="flex items-center gap-2 border-b border-slate-200 px-4">
                            <Search className="h-5 w-5 text-slate-400" />
                            <input
                                ref={inputRef}
                                value={q}
                                onChange={(e) => { setQ(e.target.value); setActive(0); }}
                                onKeyDown={(e) => {
                                    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
                                    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                                    if (e.key === 'Enter') go(results[active]);
                                }}
                                placeholder="Search pages, parties, invoice numbers…"
                                className="w-full py-4 text-base outline-none"
                            />
                        </div>
                        <ul className="max-h-[50vh] overflow-y-auto py-2">
                            {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No matches</li>}
                            {results.map((c, i) => (
                                <li key={c.id}>
                                    <button
                                        onMouseEnter={() => setActive(i)}
                                        onClick={() => go(c)}
                                        className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${i === active ? 'bg-indigo-50 text-primary' : 'text-slate-700'}`}
                                    >
                                        <span>
                                            {c.label}
                                            {c.hint && <span className="ml-2 text-xs text-slate-400">{c.hint}</span>}
                                        </span>
                                        <span className="flex items-center gap-2 text-xs text-slate-400">
                                            {c.group}
                                            {i === active && <CornerDownLeft className="h-3.5 w-3.5" />}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <div className="flex justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                            <span>↑↓ to move · Enter to open · Esc to close</span>
                            <button className="hover:text-primary" onClick={() => { setOpen(false); setHelp(true); }}>Keyboard shortcuts</button>
                        </div>
                    </div>
                </div>
            )}

            {help && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setHelp(false)}>
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-slate-800"><Keyboard className="h-5 w-5" /> Keyboard shortcuts</h2>
                        <ul className="space-y-1.5 text-sm">
                            <li className="flex justify-between"><span>Search anything</span><kbd className="rounded bg-slate-100 px-2 font-mono text-xs">Ctrl+K</kbd></li>
                            {SHORTCUTS.map((s) => (
                                <li key={s.keys} className="flex justify-between">
                                    <span>{s.label}</span>
                                    <kbd className="rounded bg-slate-100 px-2 font-mono text-xs">{s.keys}</kbd>
                                </li>
                            ))}
                            <li className="flex justify-between"><span>Save the form you are on</span><kbd className="rounded bg-slate-100 px-2 font-mono text-xs">Ctrl+Enter</kbd></li>
                            <li className="flex justify-between"><span>Show this list</span><kbd className="rounded bg-slate-100 px-2 font-mono text-xs">?</kbd></li>
                        </ul>
                    </div>
                </div>
            )}
        </>
    );
};

/** Ctrl+Enter submits the form that currently has focus (or the first form on the page). */
export const useSubmitShortcut = () => {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                const form = (document.activeElement as HTMLElement | null)?.closest('form') || document.querySelector('main form');
                if (form) {
                    e.preventDefault();
                    (form as HTMLFormElement).requestSubmit();
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
};
