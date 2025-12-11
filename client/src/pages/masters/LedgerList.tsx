import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Plus, Search, Edit2, Trash2, Eye } from 'lucide-react';
import api from '../../api/axios';
import { useNavigate } from 'react-router-dom';

interface Ledger {
    id: string;
    name: string;
    group_id?: string;
    group_name: string;
    opening_balance: number;
    opening_balance_type: string;
}

interface Group {
    id: string;
    name: string;
}

export const LedgerList: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [ledgers, setLedgers] = useState<Ledger[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingLedger, setEditingLedger] = useState<Ledger | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        groupId: '',
        openingBalance: 0,
        openingBalanceType: 'Dr'
    });

    const fetchLedgers = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const [ledgersRes, groupsRes] = await Promise.all([
                api.get(`/ledgers?companyId=${selectedCompany.id}`),
                api.get(`/ledgers/groups?companyId=${selectedCompany.id}`)
            ]);
            setLedgers(ledgersRes.data.data.ledgers);
            setGroups(groupsRes.data.data.groups);
            if (groupsRes.data.data.groups.length > 0) {
                setFormData(prev => ({ ...prev, groupId: groupsRes.data.data.groups[0].id }));
            }
        } catch (error) {
            console.error('Failed to fetch data', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLedgers();
    }, [selectedCompany]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany) return;

        try {
            if (editingLedger) {
                // Update existing ledger
                await api.put(`/ledgers/${editingLedger.id}`, {
                    ...formData,
                    companyId: selectedCompany.id
                });
            } else {
                // Create new ledger
                await api.post('/ledgers', {
                    ...formData,
                    companyId: selectedCompany.id
                });
            }
            await fetchLedgers();
            handleCloseModal();
        } catch (error) {
            console.error('Failed to save ledger', error);
        }
    };

    const handleEdit = (ledger: Ledger) => {
        setEditingLedger(ledger);
        setFormData({
            name: ledger.name,
            groupId: ledger.group_id || groups[0]?.id || '',
            openingBalance: Number(ledger.opening_balance),
            openingBalanceType: ledger.opening_balance_type
        });
        setShowModal(true);
    };

    const handleDelete = async (ledgerId: string, ledgerName: string) => {
        if (!window.confirm(`Are you sure you want to delete "${ledgerName}"?`)) {
            return;
        }

        try {
            await api.delete(`/ledgers/${ledgerId}`);
            await fetchLedgers();
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to delete ledger');
        }
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingLedger(null);
        setFormData({
            name: '',
            groupId: groups[0]?.id || '',
            openingBalance: 0,
            openingBalanceType: 'Dr'
        });
    };

    const filteredLedgers = ledgers.filter(l =>
        l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.group_name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Ledgers</h1>
                <Button onClick={() => setShowModal(true)}>
                    <Plus className="w-4 h-4" />
                    New Ledger
                </Button>
            </div>

            <div className="card">
                <div className="mb-6 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search ledgers..."
                        className="input-field pl-10"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200">
                                <th className="py-3 px-4 font-semibold text-slate-600">Name</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Group</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 text-right">Opening Balance</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={4} className="text-center py-8">Loading...</td></tr>
                            ) : filteredLedgers.length === 0 ? (
                                <tr><td colSpan={4} className="text-center py-8 text-slate-500">No ledgers found</td></tr>
                            ) : (
                                filteredLedgers.map((ledger) => (
                                    <tr key={ledger.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 font-medium text-slate-800">{ledger.name}</td>
                                        <td className="py-3 px-4 text-slate-600">{ledger.group_name}</td>
                                        <td className="py-3 px-4 text-right font-mono">
                                            {Number(ledger.opening_balance).toLocaleString()} {ledger.opening_balance_type}
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => navigate(`/ledgers/${ledger.id}/statement`)}
                                                    className="p-1 text-slate-400 hover:text-emerald-600 transition-colors"
                                                    title="View Statement"
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleEdit(ledger)}
                                                    className="p-1 text-slate-400 hover:text-primary transition-colors"
                                                    title="Edit Ledger"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(ledger.id, ledger.name)}
                                                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                                    title="Delete Ledger"
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

            {/* Create Ledger Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">
                            {editingLedger ? 'Edit Ledger' : 'Create New Ledger'}
                        </h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <Input
                                label="Ledger Name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                            />

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Group</label>
                                <select
                                    className="input-field"
                                    value={formData.groupId}
                                    onChange={(e) => setFormData({ ...formData, groupId: e.target.value })}
                                    required
                                >
                                    {groups.map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    label="Opening Balance"
                                    type="number"
                                    value={formData.openingBalance}
                                    onChange={(e) => setFormData({ ...formData, openingBalance: Number(e.target.value) })}
                                />
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                                    <select
                                        className="input-field"
                                        value={formData.openingBalanceType}
                                        onChange={(e) => setFormData({ ...formData, openingBalanceType: e.target.value })}
                                    >
                                        <option value="Dr">Dr</option>
                                        <option value="Cr">Cr</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 mt-6">
                                <Button type="button" variant="secondary" onClick={handleCloseModal}>
                                    Cancel
                                </Button>
                                <Button type="submit">
                                    {editingLedger ? 'Update Ledger' : 'Create Ledger'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
