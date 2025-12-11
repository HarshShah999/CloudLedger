import React, { useEffect, useState } from 'react';
import {
    TrendingUp,
    TrendingDown,
    Wallet,
    CreditCard
} from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';
import { useCompany } from '../context/CompanyContext';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

interface DashboardData {
    kpis: {
        receivables: number;
        payables: number;
        cashBalance: number;
        bankBalance: number;
    };
    monthlyData: {
        labels: string[];
        income: number[];
        expenses: number[];
    };
    recentTransactions: any[];
}

export const Dashboard: React.FC = () => {
    const { selectedCompany } = useCompany();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
    const [lastUpdated, setLastUpdated] = useState(new Date());

    useEffect(() => {
        const fetchDashboardData = async () => {
            if (!selectedCompany) return;

            try {
                setLoading(true);
                const response = await api.get(`/dashboard/stats?companyId=${selectedCompany.id}`);
                setDashboardData(response.data.data);
                setLastUpdated(new Date());
            } catch (error) {
                console.error('Failed to fetch dashboard data', error);
            } finally {
                setLoading(false);
            }
        };

        fetchDashboardData();
    }, [selectedCompany]);

    if (loading || !dashboardData) {
        return <div className="flex items-center justify-center min-h-screen">Loading dashboard...</div>;
    }

    const kpis = [
        {
            label: 'Total Receivables',
            value: dashboardData.kpis.receivables,
            change: 0,
            icon: TrendingUp,
            color: 'text-emerald-600',
            bg: 'bg-emerald-100'
        },
        {
            label: 'Total Payables',
            value: dashboardData.kpis.payables,
            change: 0,
            icon: TrendingDown,
            color: 'text-red-600',
            bg: 'bg-red-100'
        },
        {
            label: 'Cash Balance',
            value: dashboardData.kpis.cashBalance,
            change: 0,
            icon: Wallet,
            color: 'text-blue-600',
            bg: 'bg-blue-100'
        },
        {
            label: 'Bank Balance',
            value: dashboardData.kpis.bankBalance,
            change: 0,
            icon: CreditCard,
            color: 'text-indigo-600',
            bg: 'bg-indigo-100'
        },
    ];

    const chartData = {
        labels: dashboardData.monthlyData.labels,
        datasets: [
            {
                label: 'Income',
                data: dashboardData.monthlyData.income,
                borderColor: '#10B981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.4,
            },
            {
                label: 'Expenses',
                data: dashboardData.monthlyData.expenses,
                borderColor: '#EF4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                fill: true,
                tension: 0.4,
            },
        ],
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top' as const,
            },
        },
        scales: {
            y: {
                beginAtZero: true,
                grid: {
                    color: '#F1F5F9',
                }
            },
            x: {
                grid: {
                    display: false,
                }
            }
        }
    };

    const getVoucherIcon = (type: string) => {
        if (type?.toLowerCase().includes('sales')) return 'SAL';
        if (type?.toLowerCase().includes('purchase')) return 'PUR';
        if (type?.toLowerCase().includes('receipt')) return 'RCP';
        if (type?.toLowerCase().includes('payment')) return 'PAY';
        return 'VCH';
    };

    const getVoucherColor = (voucherType: string) => {
        if (voucherType?.toLowerCase().includes('sales')) return 'text-emerald-600';
        if (voucherType?.toLowerCase().includes('purchase')) return 'text-red-600';
        if (voucherType?.toLowerCase().includes('receipt')) return 'text-blue-600';
        if (voucherType?.toLowerCase().includes('payment')) return 'text-orange-600';
        return 'text-slate-600';
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
                <div className="text-sm text-slate-500">
                    Last updated: {lastUpdated.toLocaleTimeString()}
                </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {kpis.map((kpi, index) => {
                    const Icon = kpi.icon;
                    return (
                        <div key={index} className="card hover:shadow-md transition-shadow">
                            <div className="flex items-start justify-between mb-4">
                                <div className={`p-3 rounded-xl ${kpi.bg}`}>
                                    <Icon className={`w-6 h-6 ${kpi.color}`} />
                                </div>
                            </div>
                            <h3 className="text-slate-500 text-sm font-medium mb-1">{kpi.label}</h3>
                            <p className="text-2xl font-bold text-slate-800">
                                ₹{kpi.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </p>
                        </div>
                    );
                })}
            </div>

            {/* Charts & Recent Transactions */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Chart */}
                <div className="card lg:col-span-2">
                    <h3 className="text-lg font-bold text-slate-800 mb-6">Income vs Expenses</h3>
                    <div className="h-[300px]">
                        <Line data={chartData} options={chartOptions} />
                    </div>
                </div>

                {/* Recent Transactions */}
                <div className="card">
                    <h3 className="text-lg font-bold text-slate-800 mb-6">Recent Transactions</h3>
                    <div className="space-y-4">
                        {dashboardData.recentTransactions.length === 0 ? (
                            <p className="text-sm text-slate-500 text-center py-8">No transactions yet</p>
                        ) : (
                            dashboardData.recentTransactions.map((txn) => (
                                <div key={txn.id} className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs">
                                            {getVoucherIcon(txn.voucher_type)}
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-slate-800">{txn.voucher_type || 'Voucher'} #{txn.voucher_number}</p>
                                            <p className="text-xs text-slate-500">{new Date(txn.date).toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className={`text-sm font-bold ${getVoucherColor(txn.voucher_type)}`}>
                                            ₹{Number(txn.total_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <button
                        onClick={() => navigate('/vouchers')}
                        className="w-full mt-6 text-sm text-primary font-medium hover:underline"
                    >
                        View All Transactions
                    </button>
                </div>
            </div>
        </div>
    );
};
