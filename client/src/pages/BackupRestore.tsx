import React, { useState, useEffect } from 'react';
import { Download, Upload, Trash2, Database, FileJson, AlertTriangle, CheckCircle, Loader } from 'lucide-react';
import api from '../api/axios';

interface Backup {
    filename: string;
    size: number;
    sizeFormatted: string;
    createdAt: string;
    type: 'full' | 'company';
}

const BackupRestore: React.FC = () => {
    const [backups, setBackups] = useState<Backup[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [showRestoreModal, setShowRestoreModal] = useState(false);
    const [restoreFile, setRestoreFile] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [companies, setCompanies] = useState<any[]>([]);
    const [selectedCompany, setSelectedCompany] = useState('');
    const [exporting, setExporting] = useState(false);

    // Helper functions defined first
    const showMessage = (type: 'success' | 'error', text: string) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 5000);
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    const fetchBackups = async () => {
        setLoading(true);
        try {
            const response = await api.get('/backup/full/list');
            // Add null safety checks
            const backupsData = response.data?.data?.backups || [];
            setBackups(backupsData);
        } catch (error: any) {
            console.error('Failed to fetch backups:', error);
            setBackups([]); // Set empty array on error
            showMessage('error', error.response?.data?.message || 'Failed to fetch backups');
        } finally {
            setLoading(false);
        }
    };

    const fetchCompanies = async () => {
        try {
            const response = await api.get('/companies');
            // API returns: { status, results, data: { companies: [...] } }
            const companiesData = response.data?.data?.companies || [];
            setCompanies(companiesData);
        } catch (error) {
            console.error('Failed to fetch companies:', error);
            setCompanies([]); // Set empty array on error
        }
    };

    useEffect(() => {
        fetchBackups();
        fetchCompanies();
    }, []);

    const createBackup = async () => {
        setCreating(true);
        try {
            await api.post('/backup/full/create');
            showMessage('success', 'Backup created successfully!');
            fetchBackups();
        } catch (error: any) {
            showMessage('error', error.response?.data?.message || 'Failed to create backup');
        } finally {
            setCreating(false);
        }
    };

    const downloadBackup = async (filename: string) => {
        try {
            const response = await api.get(`/backup/full/download/${filename}`, {
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();

            showMessage('success', 'Backup downloaded successfully!');
        } catch (error: any) {
            showMessage('error', 'Failed to download backup');
        }
    };

    const deleteBackup = async (filename: string) => {
        if (!window.confirm(`Are you sure you want to delete ${filename}?`)) return;

        try {
            await api.delete(`/backup/full/${filename}`);
            showMessage('success', 'Backup deleted successfully!');
            fetchBackups();
        } catch (error: any) {
            showMessage('error', error.response?.data?.message || 'Failed to delete backup');
        }
    };

    const restoreBackup = async () => {
        if (!restoreFile || !confirmPassword) {
            showMessage('error', 'Please select a backup and enter your password');
            return;
        }

        if (!window.confirm('⚠️ WARNING: This will overwrite all current data! A safety backup will be created first. Continue?')) {
            return;
        }

        setLoading(true);
        try {
            await api.post('/backup/full/restore', {
                filename: restoreFile,
                confirmPassword
            });
            showMessage('success', 'Database restored successfully! Please refresh the page.');
            setShowRestoreModal(false);
            setRestoreFile('');
            setConfirmPassword('');
        } catch (error: any) {
            showMessage('error', error.response?.data?.message || 'Failed to restore backup');
        } finally {
            setLoading(false);
        }
    };

    const exportCompany = async () => {
        if (!selectedCompany) {
            showMessage('error', 'Please select a company');
            return;
        }

        setExporting(true);
        try {
            const response = await api.post(`/backup/company/${selectedCompany}/export`);
            showMessage('success', `Company exported: ${response.data.data.filename}`);

            // Auto-download the exported file
            const downloadResponse = await api.get(`/backup/company/download/${response.data.data.filename}`, {
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([downloadResponse.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', response.data.data.filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error: any) {
            showMessage('error', error.response?.data?.message || 'Failed to export company');
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-gray-900">Backup & Restore</h1>
                <p className="text-gray-600 mt-2">Manage database backups and company exports</p>
            </div>

            {/* Message Alert */}
            {message && (
                <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                    }`}>
                    {message.type === 'success' ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
                    <span>{message.text}</span>
                </div>
            )}

            {/* Full Database Backup Section */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <Database className="text-blue-600" size={24} />
                        <div>
                            <h2 className="text-xl font-semibold">Full Database Backup</h2>
                            <p className="text-sm text-gray-600">Complete backup of all companies and data</p>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={createBackup}
                            disabled={creating}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2"
                        >
                            {creating ? (
                                <>
                                    <Loader className="animate-spin" size={18} />
                                    Creating...
                                </>
                            ) : (
                                <>
                                    <Database size={18} />
                                    Create Backup
                                </>
                            )}
                        </button>
                        <button
                            onClick={() => setShowRestoreModal(true)}
                            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center gap-2"
                        >
                            <Upload size={18} />
                            Restore
                        </button>
                    </div>
                </div>

                {/* Backup History Table */}
                <div className="mt-6">
                    <h3 className="text-lg font-semibold mb-3">Backup History</h3>
                    {loading ? (
                        <div className="text-center py-8">
                            <Loader className="animate-spin mx-auto text-blue-600" size={32} />
                        </div>
                    ) : backups.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            No backups found. Create your first backup!
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Filename</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {backups.map((backup) => (
                                        <tr key={backup.filename} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 text-sm font-medium text-gray-900">{backup.filename}</td>
                                            <td className="px-6 py-4 text-sm text-gray-600">{backup.sizeFormatted}</td>
                                            <td className="px-6 py-4 text-sm text-gray-600">{formatDate(backup.createdAt)}</td>
                                            <td className="px-6 py-4 text-sm text-right">
                                                <button
                                                    onClick={() => downloadBackup(backup.filename)}
                                                    className="text-blue-600 hover:text-blue-800 mr-4"
                                                    title="Download"
                                                >
                                                    <Download size={18} />
                                                </button>
                                                <button
                                                    onClick={() => deleteBackup(backup.filename)}
                                                    className="text-red-600 hover:text-red-800"
                                                    title="Delete"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Company Export Section */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center gap-3 mb-4">
                    <FileJson className="text-green-600" size={24} />
                    <div>
                        <h2 className="text-xl font-semibold">Company Export</h2>
                        <p className="text-sm text-gray-600">Export individual company data as JSON</p>
                    </div>
                </div>

                <div className="flex gap-4 items-end">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Select Company</label>
                        <select
                            value={selectedCompany}
                            onChange={(e) => setSelectedCompany(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="">-- Select Company --</option>
                            {Array.isArray(companies) && companies.map((company) => (
                                <option key={company.id} value={company.id}>
                                    {company.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        onClick={exportCompany}
                        disabled={exporting || !selectedCompany}
                        className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center gap-2"
                    >
                        {exporting ? (
                            <>
                                <Loader className="animate-spin" size={18} />
                                Exporting...
                            </>
                        ) : (
                            <>
                                <Download size={18} />
                                Export Company
                            </>
                        )}
                    </button>
                </div>

                <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-800">
                        <strong>Note:</strong> Company export creates a portable JSON file containing all ledgers, vouchers, invoices, and items.
                        This can be imported into another CloudLedger instance.
                    </p>
                </div>
            </div>

            {/* Restore Modal */}
            {showRestoreModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <div className="flex items-center gap-3 mb-4">
                            <AlertTriangle className="text-orange-600" size={24} />
                            <h3 className="text-xl font-semibold">Restore Database</h3>
                        </div>

                        <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                            <p className="text-sm text-orange-800">
                                <strong>⚠️ Warning:</strong> This will overwrite all current data!
                                A safety backup will be created automatically before restore.
                            </p>
                        </div>

                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Select Backup</label>
                            <select
                                value={restoreFile}
                                onChange={(e) => setRestoreFile(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">-- Select Backup --</option>
                                {backups.map((backup) => (
                                    <option key={backup.filename} value={backup.filename}>
                                        {backup.filename} ({backup.sizeFormatted})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Confirm Password</label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Enter your password to confirm"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setShowRestoreModal(false);
                                    setRestoreFile('');
                                    setConfirmPassword('');
                                }}
                                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={restoreBackup}
                                disabled={loading || !restoreFile || !confirmPassword}
                                className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-gray-400"
                            >
                                {loading ? 'Restoring...' : 'Restore'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export { BackupRestore };
