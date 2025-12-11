import React, { useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Plus, Building2, Calendar } from 'lucide-react';
import api from '../../api/axios';

export const CompanyList: React.FC = () => {
    const { companies, refreshCompanies, selectCompany, selectedCompany } = useCompany();
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        address: '',
        state: '',
        email: '',
        phone: '',
        gstin: '',
        currency: 'INR',
        financialYear: {
            name: '2024-2025',
            startDate: '2024-04-01',
            endDate: '2025-03-31'
        }
    });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await api.post('/companies', formData);
            await refreshCompanies();
            setShowModal(false);
            setFormData({
                name: '',
                address: '',
                state: '',
                email: '',
                phone: '',
                gstin: '',
                currency: 'INR',
                financialYear: {
                    name: '2024-2025',
                    startDate: '2024-04-01',
                    endDate: '2025-03-31'
                }
            });
        } catch (error) {
            console.error('Failed to create company', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Companies</h1>
                <Button onClick={() => setShowModal(true)}>
                    <Plus className="w-4 h-4" />
                    New Company
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {companies.map((company) => (
                    <div
                        key={company.id}
                        className={`card hover:shadow-md transition-shadow cursor-pointer border-2 ${selectedCompany?.id === company.id ? 'border-primary' : 'border-transparent'}`}
                        onClick={() => selectCompany(company.id)}
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div className="p-3 rounded-xl bg-indigo-50 text-indigo-600">
                                <Building2 className="w-6 h-6" />
                            </div>
                            {selectedCompany?.id === company.id && (
                                <span className="bg-primary text-white text-xs px-2 py-1 rounded-full">Active</span>
                            )}
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 mb-2">{company.name}</h3>
                        <p className="text-slate-500 text-sm mb-4">{company.role}</p>
                        <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 p-2 rounded-lg">
                            <Calendar className="w-4 h-4" />
                            <span>FY: 2024-2025</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Simple Modal Implementation */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">Create New Company</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <Input
                                label="Company Name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                            <Input
                                label="Address"
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            />
                            <Input
                                label="State"
                                placeholder="State (e.g. Maharashtra)"
                                value={formData.state}
                                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                            />
                            <Input
                                label="GSTIN"
                                placeholder="Enter GSTIN Number"
                                value={formData.gstin}
                                onChange={(e) => setFormData({ ...formData, gstin: e.target.value })}
                            />
                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    label="Email"
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                />
                                <Input
                                    label="Phone"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                />
                            </div>
                            <div className="flex justify-end gap-3 mt-6">
                                <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit" isLoading={loading}>
                                    Create Company
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
