import React, { useEffect, useState } from 'react';
import { UserPlus, Edit2, Trash2, Shield, KeyRound } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import api, { apiError } from '../api/axios';
import { notify } from '../utils/notification';
import { formatDate } from '../lib/dates';

interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    created_at: string;
}

export const Users: React.FC = () => {
    const { user: currentUser } = useAuth();
    const { selectedCompany, isCompanyAdmin } = useCompany();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        role: 'viewer'
    });

    const isAdmin = isCompanyAdmin;
    const base = `/companies/${selectedCompany?.id}/members`;

    const fetchUsers = async () => {
        if (!selectedCompany) return;
        setLoading(true);
        try {
            const response = await api.get(base);
            setUsers(response.data.data.users);
        } catch (error) {
            console.error('Failed to fetch users', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, [selectedCompany?.id]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingUser) {
                // Update user
                await api.put(`${base}/${editingUser.id}`, { role: formData.role });
                notify.success('Role updated');
            } else {
                // Create user
                await api.post(base, formData);
                notify.success('User added to company');
            }
            await fetchUsers();
            handleCloseModal();
        } catch (error: any) {
            notify.error(apiError(error, 'Failed to save user'));
        }
    };

    const handleEdit = (user: User) => {
        setEditingUser(user);
        setFormData({
            name: user.name,
            email: user.email,
            password: '',
            role: user.role
        });
        setShowModal(true);
    };

    const sendResetLink = async (user: User) => {
        if (!window.confirm(`Email ${user.name} (${user.email}) a link to set a new password? Their current password keeps working until they use the link.`)) return;
        try {
            const r = await api.post(`${base}/${user.id}/password-reset`, {});
            notify.success(r.data.message);
        } catch (error: any) {
            notify.error(apiError(error, 'Could not send the link'));
        }
    };

    const handleDelete = async (userId: string, userName: string) => {
        if (!window.confirm(`Remove "${userName}" from ${selectedCompany?.name}? Their login stays, but they lose access to this company.`)) {
            return;
        }

        try {
            await api.delete(`${base}/${userId}`);
            notify.success('User removed from company');
            await fetchUsers();
        } catch (error: any) {
            notify.error(apiError(error, 'Failed to remove user'));
        }
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingUser(null);
        setFormData({
            name: '',
            email: '',
            password: '',
            role: 'viewer'
        });
    };

    const getRoleBadgeColor = (role: string) => {
        switch (role) {
            case 'admin':
                return 'bg-purple-100 text-purple-700';
            case 'accountant':
                return 'bg-blue-100 text-blue-700';
            default:
                return 'bg-slate-100 text-slate-700';
        }
    };

    if (!isAdmin) {
        return (
            <div className="space-y-6">
                <h1 className="text-2xl font-bold text-slate-800">Users</h1>
                <div className="card text-center py-12">
                    <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-slate-700 mb-2">Access Restricted</h3>
                    <p className="text-slate-500">
                        Only admins of {selectedCompany?.name || 'this company'} can manage its users.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Users</h1>
                    <p className="text-sm text-slate-500">People who can access {selectedCompany?.name}. Admins manage settings and users, accountants enter transactions, viewers can only read.</p>
                </div>
                <Button onClick={() => setShowModal(true)}>
                    <UserPlus className="w-4 h-4" />
                    Add User
                </Button>
            </div>

            <div className="card">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200">
                                <th className="py-3 px-4 font-semibold text-slate-600">Name</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Email</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Role</th>
                                <th className="py-3 px-4 font-semibold text-slate-600">Since</th>
                                <th className="py-3 px-4 font-semibold text-slate-600 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={5} className="text-center py-8">Loading...</td></tr>
                            ) : users.length === 0 ? (
                                <tr><td colSpan={5} className="text-center py-8 text-slate-500">No users found</td></tr>
                            ) : (
                                users.map((user) => (
                                    <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="py-3 px-4 font-medium text-slate-800">{user.name}</td>
                                        <td className="py-3 px-4 text-slate-600">{user.email}</td>
                                        <td className="py-3 px-4">
                                            <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${getRoleBadgeColor(user.role)}`}>
                                                {user.role}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-slate-600 text-sm">
                                            {formatDate(user.created_at)}
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleEdit(user)}
                                                    className="p-1 text-slate-400 hover:text-primary transition-colors"
                                                    title="Edit User"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                {user.id !== currentUser?.id && (
                                                    <button
                                                        onClick={() => sendResetLink(user)}
                                                        className="p-1 text-slate-400 hover:text-primary transition-colors"
                                                        title="Send password reset link"
                                                    >
                                                        <KeyRound className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleDelete(user.id, user.name)}
                                                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                                    title="Remove from company"
                                                    disabled={user.id === currentUser?.id}
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

            {/* Create/Edit User Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">
                            {editingUser ? 'Change Role' : 'Add User to Company'}
                        </h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {editingUser ? (
                                <p className="text-sm text-slate-600">
                                    {editingUser.name} ({editingUser.email})
                                </p>
                            ) : (
                                <>
                                    <Input
                                        label="Email Address"
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        required
                                    />
                                    <p className="text-xs text-slate-500 -mt-2">
                                        If this person already has a Taalmel login they are simply added. Otherwise fill in the name and an initial password.
                                    </p>
                                    <Input
                                        label="Full Name"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    />
                                    <Input
                                        label="Initial Password"
                                        type="password"
                                        value={formData.password}
                                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                        minLength={8}
                                    />
                                </>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                                <select
                                    className="input-field"
                                    value={formData.role}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                    required
                                >
                                    <option value="viewer">Viewer</option>
                                    <option value="accountant">Accountant</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>

                            <div className="flex justify-end gap-3 mt-6">
                                <Button type="button" variant="secondary" onClick={handleCloseModal}>
                                    Cancel
                                </Button>
                                <Button type="submit">
                                    {editingUser ? 'Save Role' : 'Add User'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
