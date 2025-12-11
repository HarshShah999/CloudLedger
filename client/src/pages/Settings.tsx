import React, { useState } from 'react';
import { Save, Lock, User, CheckCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

export const Settings: React.FC = () => {
    const { user, setUser } = useAuth();
    const [loading, setLoading] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');

    // Profile form
    const [profileData, setProfileData] = useState({
        name: user?.name || '',
        email: user?.email || ''
    });

    // Password form
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [passwordError, setPasswordError] = useState('');

    const handleProfileUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setSuccessMessage('');

        try {
            const response = await api.put(`/users/${user?.id}`, profileData);
            setUser(response.data.data.user);
            setSuccessMessage('Profile updated successfully!');
            setTimeout(() => setSuccessMessage(''), 3000);
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to update profile');
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError('');
        setSuccessMessage('');

        // Validate passwords match
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            setPasswordError('New passwords do not match');
            return;
        }

        // Validate password length
        if (passwordData.newPassword.length < 6) {
            setPasswordError('Password must be at least 6 characters');
            return;
        }

        setLoading(true);
        try {
            await api.put('/users/me/password', {
                currentPassword: passwordData.currentPassword,
                newPassword: passwordData.newPassword
            });
            setSuccessMessage('Password changed successfully!');
            setPasswordData({
                currentPassword: '',
                newPassword: '',
                confirmPassword: ''
            });
            setTimeout(() => setSuccessMessage(''), 3000);
        } catch (error: any) {
            setPasswordError(error.response?.data?.message || 'Failed to change password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
            </div>

            {/* Success Message */}
            {successMessage && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    {successMessage}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Profile Settings */}
                <div className="card lg:col-span-2">
                    <div className="flex items-center gap-3 mb-6">
                        <User className="w-6 h-6 text-primary" />
                        <h3 className="text-lg font-bold text-slate-800">Profile Settings</h3>
                    </div>
                    <form onSubmit={handleProfileUpdate} className="space-y-4">
                        <Input
                            label="Full Name"
                            value={profileData.name}
                            onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
                            required
                        />
                        <Input
                            label="Email Address"
                            type="email"
                            value={profileData.email}
                            onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                            required
                        />
                        <Input
                            label="Role"
                            value={user?.role || ''}
                            disabled
                        />
                        <div className="pt-4">
                            <Button type="submit" isLoading={loading}>
                                <Save className="w-4 h-4" />
                                Save Changes
                            </Button>
                        </div>
                    </form>
                </div>

                {/* Account Info */}
                <div className="card">
                    <h3 className="text-lg font-bold text-slate-800 mb-6">Account Info</h3>
                    <div className="space-y-4">
                        <div>
                            <p className="text-sm text-slate-500">Account Type</p>
                            <p className="font-medium text-slate-800 capitalize">{user?.role}</p>
                        </div>
                        <div>
                            <p className="text-sm text-slate-500">Status</p>
                            <p className="font-medium text-emerald-600">Active</p>
                        </div>
                        <div>
                            <p className="text-sm text-slate-500">Email</p>
                            <p className="font-medium text-slate-800 text-sm break-all">{user?.email}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Change Password */}
            <div className="card lg:max-w-2xl">
                <div className="flex items-center gap-3 mb-6">
                    <Lock className="w-6 h-6 text-primary" />
                    <h3 className="text-lg font-bold text-slate-800">Change Password</h3>
                </div>

                {passwordError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
                        {passwordError}
                    </div>
                )}

                <form onSubmit={handlePasswordChange} className="space-y-4">
                    <Input
                        label="Current Password"
                        type="password"
                        value={passwordData.currentPassword}
                        onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                        required
                    />
                    <Input
                        label="New Password"
                        type="password"
                        value={passwordData.newPassword}
                        onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                        required
                        minLength={6}
                    />
                    <Input
                        label="Confirm New Password"
                        type="password"
                        value={passwordData.confirmPassword}
                        onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                        required
                        minLength={6}
                    />
                    <div className="pt-4">
                        <Button type="submit" isLoading={loading}>
                            <Lock className="w-4 h-4" />
                            Change Password
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};
