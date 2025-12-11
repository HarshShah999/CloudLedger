import React, { useEffect, useState } from 'react';
import { UserPlus, Edit2, Trash2, Shield } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    created_at: string;
}

export const Users: React.FC = () => {
    const { user: currentUser } = useAuth();
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

    const isAdmin = currentUser?.role === 'admin';

    const fetchUsers = async () => {
        if (!isAdmin) return;
        setLoading(true);
        try {
            const response = await api.get('/users');
            setUsers(response.data.data.users);
        } catch (error) {
            console.error('Failed to fetch users', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingUser) {
                // Update user
                await api.put(`/users/${editingUser.id}`, {
                    name: formData.name,
                    email: formData.email,
                    role: formData.role
                });
            } else {
                // Create user
                await api.post('/users', formData);
            }
            await fetchUsers();
            handleCloseModal();
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to save user');
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

    const handleDelete = async (userId: string, userName: string) => {
        if (!window.confirm(`Are you sure you want to delete "${userName}"?`)) {
            return;
        }

        try {
            await api.delete(`/users/${userId}`);
            await fetchUsers();
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to delete user');
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
                        You need admin privileges to manage users.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Users</h1>
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
                                <th className="py-3 px-4 font-semibold text-slate-600">Created</th>
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
                                            {new Date(user.created_at).toLocaleDateString()}
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
                                                <button
                                                    onClick={() => handleDelete(user.id, user.name)}
                                                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                                    title="Delete User"
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
                            {editingUser ? 'Edit User' : 'Add New User'}
                        </h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <Input
                                label="Full Name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                            <Input
                                label="Email Address"
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                            />
                            {!editingUser && (
                                <Input
                                    label="Password"
                                    type="password"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    required
                                    minLength={6}
                                />
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
                                    {editingUser ? 'Update User' : 'Create User'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
