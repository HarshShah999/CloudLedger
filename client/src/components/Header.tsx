import React, { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { LogOut, User as UserIcon, ChevronDown, Menu, Search } from 'lucide-react';

export const Header: React.FC<{ onMenu?: () => void }> = ({ onMenu }) => {
    const { user, logout } = useAuth();
    const { companies, selectedCompany, selectCompany } = useCompany();
    const [fyName, setFyName] = useState<string>('');

    useEffect(() => {
        setFyName('');
        if (!selectedCompany) return;
        api.get('/financial-years/active', { params: { companyId: selectedCompany.id } })
            .then((res) => setFyName(res.data.data.financialYear.name))
            .catch(() => setFyName(''));
    }, [selectedCompany?.id]);

    return (
        <header className="h-16 bg-white border-b border-slate-200 fixed top-0 right-0 left-0 lg:left-64 z-20 px-3 sm:px-6 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <button
                    onClick={onMenu}
                    className="lg:hidden p-2 -ml-1 text-slate-600 hover:bg-slate-100 rounded-lg"
                    aria-label="Open menu"
                >
                    <Menu className="w-6 h-6" />
                </button>
                {companies.length > 0 ? (
                    <label className="relative flex items-center min-w-0">
                        <span className="sr-only">Company</span>
                        <select
                            value={selectedCompany?.id || ''}
                            onChange={(e) => selectCompany(e.target.value)}
                            className="appearance-none bg-transparent pr-6 text-base sm:text-lg font-medium text-slate-700 hover:text-primary cursor-pointer truncate max-w-[55vw] sm:max-w-xs focus:outline-none"
                        >
                            {companies.map((company) => (
                                <option key={company.id} value={company.id}>{company.name}</option>
                            ))}
                        </select>
                        <ChevronDown className="w-4 h-4 absolute right-0 pointer-events-none text-slate-500" />
                    </label>
                ) : (
                    <span className="text-slate-500 text-sm">No companies yet</span>
                )}

                <div className="hidden sm:block h-6 w-px bg-slate-200 mx-2"></div>

                <div className="hidden sm:flex items-center gap-2 text-sm text-slate-500 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap">
                    <span>{fyName ? `FY: ${fyName}` : 'No active FY'}</span>
                </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                <button
                    onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-500 hover:border-slate-300 hover:text-slate-700"
                    title="Search (Ctrl+K)"
                >
                    <Search className="h-4 w-4" />
                    <span className="hidden lg:inline">Search</span>
                    <kbd className="hidden rounded bg-slate-100 px-1.5 font-mono text-xs lg:inline">Ctrl K</kbd>
                </button>
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center" title={user?.name}>
                        <UserIcon className="w-4 h-4" />
                    </div>
                    <div className="text-sm hidden md:block">
                        <p className="font-medium text-slate-700">{user?.name}</p>
                        <p className="text-xs text-slate-500 capitalize">{selectedCompany?.role || (user?.is_superadmin ? 'owner' : '')}</p>
                    </div>
                </div>

                <button
                    onClick={logout}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Logout"
                >
                    <LogOut className="w-5 h-5" />
                </button>
            </div>
        </header>
    );
};
