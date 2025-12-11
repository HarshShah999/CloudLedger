import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompany } from '../../context/CompanyContext';
import { Button } from '../../components/ui/Button';
import { Plus, Search, Edit2, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../api/axios';

interface Voucher {
    id: string;
    voucher_number: string;
    date: string;
    voucher_type_name: string;
    total_amount: number;
    narration: string;
}

export const VoucherList: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [vouchers, setVouchers] = useState<Voucher[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchVouchers = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const response = await api.get(`/vouchers?companyId=${selectedCompany.id}`);
            setVouchers(response.data.data.vouchers);
        } catch (error) {
            console.error('Failed to fetch vouchers', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchVouchers();
    }, [selectedCompany]);

    const handleDelete = async (voucherId: string, voucherNumber: string) => {
        if (!window.confirm(`Are you sure you want to delete voucher "${voucherNumber}"?`)) {
            return;
        }

        try {
            await api.delete(`/vouchers/${voucherId}`);
            await fetchVouchers();
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to delete voucher');
        }
    };

    const filteredVouchers = vouchers.filter(v =>
        v.voucher_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.narration?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Vouchers</h1>
                <Link to="/vouchers/create">
                    <Button>
                        <Plus className="w-4 h-4" />
                        New Voucher
                    </Button>
                </Link>
            </div>

            <div className="card">
                <div className="mb-6 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search vouchers..."
                        className="input-field pl-10"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200">
                                <th className="py-3 px-4 font-semibold text-slate-600">Date</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Voucher No</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Type</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Narration</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 text-right">Amount</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={6} className="text-center py-8">Loading...</td></tr>
                            ) : filteredVouchers.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-8 text-slate-500">No vouchers found</td></tr>
                            ) : (
                                filteredVouchers.map((voucher) => (
                                    <tr key={voucher.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 text-slate-600">
                                            {new Date(voucher.date).toLocaleDateString()}
                                        </td>
                                        <td className="py-3 px-4 font-medium text-slate-800">{voucher.voucher_number}</td>
                                        <td className="py-3 px-4 text-slate-600">
                                            <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded text-xs font-medium">
                                                {voucher.voucher_type_name}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-slate-600 truncate max-w-xs">{voucher.narration}</td>
                                        <td className="py-3 px-4 text-right font-bold text-slate-800">
                                            ₹{Number(voucher.total_amount).toLocaleString()}
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => navigate(`/vouchers/edit/${voucher.id}`)}
                                                    className="p-1 text-slate-400 hover:text-primary transition-colors"
                                                    title="Edit Voucher"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(voucher.id, voucher.voucher_number)}
                                                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                                    title="Delete Voucher"
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
        </div>
    );
};
