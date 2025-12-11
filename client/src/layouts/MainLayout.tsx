import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { CompanyProvider } from '../context/CompanyContext';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';

export const MainLayout: React.FC = () => {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    return (
        <CompanyProvider>
            <div className="min-h-screen bg-slate-50">
                <Sidebar />
                <Header />
                <main className="pl-64 pt-16 min-h-screen">
                    <div className="p-6 max-w-7xl mx-auto">
                        <Outlet />
                    </div>
                </main>
            </div>
        </CompanyProvider>
    );
};
