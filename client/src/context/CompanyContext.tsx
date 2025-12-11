import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';
import { useAuth } from './AuthContext';

interface Company {
    id: string;
    name: string;
    currency: string;
    role: string;
    gstin?: string;
}

interface CompanyContextType {
    companies: Company[];
    selectedCompany: Company | null;
    isLoading: boolean;
    selectCompany: (companyId: string) => void;
    refreshCompanies: () => void;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated } = useAuth();
    const [companies, setCompanies] = useState<Company[]>([]);
    const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const fetchCompanies = async () => {
        if (!isAuthenticated) return;
        setIsLoading(true);
        try {
            const response = await api.get('/companies');
            setCompanies(response.data.data.companies);

            // Auto-select first company if none selected
            if (response.data.data.companies.length > 0 && !selectedCompany) {
                // Check local storage
                const savedId = localStorage.getItem('selectedCompanyId');
                const savedCompany = response.data.data.companies.find((c: Company) => c.id === savedId);

                if (savedCompany) {
                    setSelectedCompany(savedCompany);
                } else {
                    setSelectedCompany(response.data.data.companies[0]);
                    localStorage.setItem('selectedCompanyId', response.data.data.companies[0].id);
                }
            }
        } catch (error) {
            console.error('Failed to fetch companies', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchCompanies();
    }, [isAuthenticated]);

    const selectCompany = (companyId: string) => {
        const company = companies.find((c) => c.id === companyId);
        if (company) {
            setSelectedCompany(company);
            localStorage.setItem('selectedCompanyId', companyId);
        }
    };

    return (
        <CompanyContext.Provider
            value={{
                companies,
                selectedCompany,
                isLoading,
                selectCompany,
                refreshCompanies: fetchCompanies,
            }}
        >
            {children}
        </CompanyContext.Provider>
    );
};

export const useCompany = () => {
    const context = useContext(CompanyContext);
    if (context === undefined) {
        throw new Error('useCompany must be used within a CompanyProvider');
    }
    return context;
};
