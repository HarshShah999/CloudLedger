import React, { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { CompanyProvider } from '../context/CompanyContext';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { CommandPalette, useSubmitShortcut } from '../components/CommandPalette';

export const MainLayout: React.FC = () => {
    const { isAuthenticated, isLoading } = useAuth();
    const [navOpen, setNavOpen] = useState(false);
    useSubmitShortcut();

    if (isLoading) {
        return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    return (
        <CompanyProvider>
            <div className="min-h-screen bg-slate-50">
                <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
                <Header onMenu={() => setNavOpen(true)} />
                <CommandPalette />
                <main className="lg:pl-64 pt-16 min-h-screen">
                    <div className="p-3 sm:p-6 max-w-7xl mx-auto">
                        <Outlet />
                    </div>
                </main>
            </div>
        </CompanyProvider>
    );
};
