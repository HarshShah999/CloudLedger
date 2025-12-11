import React, { useEffect, useState } from 'react';
import { useCompany } from '../context/CompanyContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Plus, Lock, Unlock, Edit2, Trash2, CheckCircle, XCircle } from 'lucide-react';
import api from '../api/axios';

interface FinancialYear {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    is_active: boolean;
    is_closed: boolean;
}

export const FinancialYears: React.FC = () => {
    const { selectedCompany } = useCompany();
    const [years, setYears] = useState<FinancialYear[]>([]);
    const [loading, setLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        startDate: '',
        endDate: ''
    });

    const fetchYears = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const response = await api.get('/financial-years', {
                params: { companyId: selectedCompany.id }
            });
            setYears(response.data.data.financialYears);
        } catch (error) {
            console.error('Failed to fetch financial years', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchYears();
    }, [selectedCompany]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany) return;

        try {
            await api.post('/financial-years', {
                companyId: selectedCompany.id,
                name: formData.name,
                startDate: formData.startDate,
                endDate: formData.endDate
            });
            await fetchYears();
            handleCloseModal();
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to create financial year');
        }
    };

    const handleActivate = async (yearId: string) => {
        if (!selectedCompany) return;
        try {
            await api.put(`/financial-years/${yearId}/activate`, {
                companyId: selectedCompany.id
            });
            await fetchYears();
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to activate year');
        }
    };

    const handleClose = async (yearId: string, yearName: string) => {
        if (!window.confirm(`Are you sure you want to close "${yearName}"? This will lock the period and prevent any changes.`)) {
            return;
        }

        try {
            await api.put(`/financial-years/${yearId}/close`);
            await fetchYears();
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to close year');
        }
    };

    const handleReopen = async (yearId: string) => {
        try {
            await api.put(`/financial-years/${yearId}/reopen`);
            await fetchYears();
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to reopen year');
        }
    };

    const handleDelete = async (yearId: string, yearName: string) => {
        if (!window.confirm(`Are you sure you want to delete "${yearName}"?`)) {
            return;
        }

        try {
            await api.delete(`/financial-years/${yearId}`);
            await fetchYears();
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to delete year');
        }
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setFormData({
            name: '',
            startDate: '',
            endDate: ''
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Financial Years</h1>
                <Button onClick={() => setShowModal(true)}>
                    <Plus className="w-4 h-4" />
                    New Financial Year
                </Button>
            </div>

            <div className="card">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200">
                                <th className="py-3 px-4 font-semibold text-slate-600">Name</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Period</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Status</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={4} className="text-center py-8">Loading...</td></tr>
                            ) : years.length === 0 ? (
                                <tr><td colSpan={4} className="text-center py-8 text-slate-500">No financial years found</td></tr>
                            ) : (
                                years.map((year) => (
                                    <tr key={year.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 font-medium text-slate-800">{year.name}</td>
                                        <td className="py-3 px-4 text-slate-600">
                                            {new Date(year.start_date).toLocaleDateString()} - {new Date(year.end_date).toLocaleDateString()}
                                        </td>
                                        <td className="py-3 px-4">
                                            <div className="flex items-center gap-2">
                                                {year.is_active && (
                                                    <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
                                                        Active
                                                    </span>
                                                )}
                                                {year.is_closed ? (
                                                    <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 flex items-center gap-1">
                                                        <Lock className="w-3 h-3" />
                                                        Closed
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700 flex items-center gap-1">
                                                        <Unlock className="w-3 h-3" />
                                                        Open
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {!year.is_active && !year.is_closed && (
                                                    <button
                                                        onClick={() => handleActivate(year.id)}
                                                        className="p-1 text-slate-400 hover:text-emerald-600 transition-colors"
                                                        title="Activate Year"
                                                    >
                                                        <CheckCircle className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {!year.is_closed ? (
                                                    <button
                                                        onClick={() => handleClose(year.id, year.name)}
                                                        className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                                                        title="Close Year"
                                                    >
                                                        <Lock className="w-4 h-4" />
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleReopen(year.id)}
                                                        className="p-1 text-slate-400 hover:text-emerald-600 transition-colors"
                                                        title="Reopen Year"
                                                    >
                                                        <Unlock className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleDelete(year.id, year.name)}
                                                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                                    title="Delete Year"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Financial Year Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">Create Financial Year</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <Input
                                label="Year Name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="e.g., FY 2024-25"
                                required
                            />
                            <Input
                                label="Start Date"
                                type="date"
                                value={formData.startDate}
                                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                                required
                            />
                            <Input
                                label="End Date"
                                type="date"
                                value={formData.endDate}
                                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                                required
                            />

                            <div className="flex justify-end gap-3 mt-6">
                                <Button type="button" variant="secondary" onClick={handleCloseModal}>
                                    Cancel
                                </Button>
                                <Button type="submit">
                                    Create Year
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
