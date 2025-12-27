import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import {
    LayoutDashboard,
    Building2,
    BookOpen,
    FileText,
    BarChart3,
    Users,
    Settings,
    ChevronDown,
    ChevronRight,
    Package,
    Repeat,
    Database
} from 'lucide-react';

const mainNavItems = [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { label: 'Companies', icon: Building2, path: '/companies' },
    { label: 'Financial Years', icon: Building2, path: '/financial-years' },
    { label: 'Ledgers', icon: BookOpen, path: '/ledgers' },
    { label: 'Items', icon: Package, path: '/inventory/items' },
    { label: 'Invoices', icon: FileText, path: '/invoices' },
    { label: 'Recurring', icon: Repeat, path: '/recurring-invoices' },
    { label: 'Vouchers', icon: FileText, path: '/vouchers' },
    { label: 'Banking', icon: Building2, path: '/banking/reconciliation' },
];

const reportItems = [
    { label: 'Trial Balance', path: '/reports' },
    { label: 'Profit & Loss', path: '/reports/profit-loss' },
    { label: 'Balance Sheet', path: '/reports/balance-sheet' },
];

const bottomNavItems = [
    { label: 'Backup', icon: Database, path: '/backup' },
    { label: 'Users', icon: Users, path: '/users' },
    { label: 'Settings', icon: Settings, path: '/settings' },
];

export const Sidebar: React.FC = () => {
    const location = useLocation();
    const [reportsOpen, setReportsOpen] = useState(true);

    return (
        <aside className="w-64 bg-slate-900 text-white h-screen fixed left-0 top-0 flex flex-col">
            <div className="p-6 shrink-0">
                <h1 className="text-2xl font-bold text-white flex items-center">
                    {/* <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                        CL
                    </div> */}
                    <div className=" flex items-center justify-center">
                    <img src="../assets/logo.png" alt="CloudLedger Logo" className="w-16 h-16" /></div>
                    CloudLedger
                </h1>
            </div>

            <nav className="px-4 py-2 flex-1 overflow-y-auto custom-scrollbar">
                <ul className="space-y-1">
                    {mainNavItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;

                        return (
                            <li key={item.path}>
                                <Link
                                    to={item.path}
                                    className={clsx(
                                        'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                                        isActive
                                            ? 'bg-primary text-white'
                                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                    )}
                                >
                                    <Icon className="w-5 h-5" />
                                    <span className="font-medium">{item.label}</span>
                                </Link>
                            </li>
                        );
                    })}

                    {/* Reports Submenu */}
                    <li>
                        <button
                            onClick={() => setReportsOpen(!reportsOpen)}
                            className={clsx(
                                'w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg transition-colors',
                                location.pathname.startsWith('/reports')
                                    ? 'bg-primary text-white'
                                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <BarChart3 className="w-5 h-5" />
                                <span className="font-medium">Reports</span>
                            </div>
                            {reportsOpen ? (
                                <ChevronDown className="w-4 h-4" />
                            ) : (
                                <ChevronRight className="w-4 h-4" />
                            )}
                        </button>
                        {reportsOpen && (
                            <ul className="ml-8 mt-1 space-y-1">
                                {reportItems.map((item) => {
                                    const isActive = location.pathname === item.path;
                                    return (
                                        <li key={item.path}>
                                            <Link
                                                to={item.path}
                                                className={clsx(
                                                    'block px-4 py-2 rounded-lg text-sm transition-colors',
                                                    isActive
                                                        ? 'bg-primary/20 text-white font-medium'
                                                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                                )}
                                            >
                                                {item.label}
                                            </Link>
                                        </li>
                                    );
                                })}
                                {/* GST Returns */}
                                <li key="/reports/gstr-1">
                                    <Link
                                        to="/reports/gstr-1"
                                        className={clsx(
                                            'block px-4 py-2 rounded-lg text-sm transition-colors',
                                            location.pathname === '/reports/gstr-1'
                                                ? 'bg-primary/20 text-white font-medium'
                                                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                        )}
                                    >
                                        GSTR-1
                                    </Link>
                                </li>
                                <li key="/reports/gstr-3b">
                                    <Link
                                        to="/reports/gstr-3b"
                                        className={clsx(
                                            'block px-4 py-2 rounded-lg text-sm transition-colors',
                                            location.pathname === '/reports/gstr-3b'
                                                ? 'bg-primary/20 text-white font-medium'
                                                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                        )}
                                    >
                                        GSTR-3B
                                    </Link>
                                </li>
                            </ul>
                        )}
                    </li>

                    {/* Documents Dropdown */}
                    <li>
                        <details className="group" open={location.pathname.startsWith('/invoices')}>
                            <summary className="flex items-center justify-between px-4 py-3 text-slate-300 hover:bg-slate-800 rounded-lg cursor-pointer transition-colors">
                                <div className="flex items-center gap-3">
                                    <FileText className="w-5 h-5 text-indigo-400" />
                                    <span className="font-medium">Documents</span>
                                </div>
                                <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                            </summary>
                            <ul className="mt-2 space-y-1 pl-11 pr-2">
                                <li>
                                    <Link to="/invoices" className="block px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg">All Invoices</Link>
                                </li>
                                <li>
                                    <Link to="/invoices/create/sales" className="block px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg">New Sales Invoice</Link>
                                </li>
                                <li>
                                    <Link to="/invoices/create/purchase" className="block px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg">New Purchase Invoice</Link>
                                </li>
                                <li>
                                    <Link to="/invoices/create/credit-note" className="block px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg">New Credit Note</Link>
                                </li>
                                <li>
                                    <Link to="/invoices/create/debit-note" className="block px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg">New Debit Note</Link>
                                </li>
                            </ul>
                        </details>
                    </li>

                    {bottomNavItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;

                        return (
                            <li key={item.path}>
                                <Link
                                    to={item.path}
                                    className={clsx(
                                        'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                                        isActive
                                            ? 'bg-primary text-white'
                                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                    )}
                                >
                                    <Icon className="w-5 h-5" />
                                    <span className="font-medium">{item.label}</span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            <div className="p-4 border-t border-slate-800 shrink-0">
                <div className="bg-slate-800 rounded-lg p-3">
                    <p className="text-xs text-slate-400 uppercase font-semibold mb-1">Support</p>
                    <p className="text-sm text-slate-300">help@cloudledger.com</p>
                </div>
            </div>
        </aside>
    );
};
