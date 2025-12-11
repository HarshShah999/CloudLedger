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
        <aside className="w-64 bg-slate-900 text-white min-h-screen fixed left-0 top-0 overflow-y-auto">
            <div className="p-6">
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                    <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                        CL
                    </div>
                    CloudLedger
                </h1>
            </div>

            <nav className="px-4 py-2">
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
                            </ul>
                        )}
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

            <div className="absolute bottom-0 w-full p-4 border-t border-slate-800">
                <div className="bg-slate-800 rounded-lg p-3">
                    <p className="text-xs text-slate-400 uppercase font-semibold mb-1">Support</p>
                    <p className="text-sm text-slate-300">help@cloudledger.com</p>
                </div>
            </div>
        </aside>
    );
};
