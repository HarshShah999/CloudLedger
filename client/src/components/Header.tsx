import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { LogOut, User as UserIcon, ChevronDown } from 'lucide-react';

export const Header: React.FC = () => {
    const { user, logout } = useAuth();
    const { companies, selectedCompany, selectCompany } = useCompany();

    return (
        <header className="h-16 bg-white border-b border-slate-200 fixed top-0 right-0 left-64 z-10 px-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
                {companies.length > 0 ? (
                    <div className="relative group">
                        <button className="flex items-center gap-2 text-slate-700 font-medium hover:text-primary transition-colors">
                            <span className="text-lg">{selectedCompany?.name || 'Select Company'}</span>
                            <ChevronDown className="w-4 h-4" />
                        </button>

                        <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-slate-100 py-2 hidden group-hover:block">
                            {companies.map((company) => (
                                <button
                                    key={company.id}
                                    onClick={() => selectCompany(company.id)}
                                    className="w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-700"
                                >
                                    {company.name}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <span className="text-slate-500">No companies found</span>
                )}

                <div className="h-6 w-px bg-slate-200 mx-2"></div>

                <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                    <span>FY: 2024-2025</span>
                </div>
            </div>

            <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center">
                        <UserIcon className="w-4 h-4" />
                    </div>
                    <div className="text-sm">
                        <p className="font-medium text-slate-700">{user?.name}</p>
                        <p className="text-xs text-slate-500 capitalize">{user?.role}</p>
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
