import React from 'react';
import { Toaster } from 'react-hot-toast';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AuthLayout } from './layouts/AuthLayout';
import { Login } from './pages/auth/Login';
import { Register } from './pages/auth/Register';
import { MainLayout } from './layouts/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { CompanyList } from './pages/masters/CompanyList';
import { LedgerList } from './pages/masters/LedgerList';
import { VoucherList } from './pages/vouchers/VoucherList';
import { VoucherEntry } from './pages/vouchers/VoucherEntry';
import { TrialBalance } from './pages/reports/TrialBalance';
import { LedgerStatement } from './pages/ledgers/LedgerStatement';
import { Users } from './pages/Users';
import { Settings } from './pages/Settings';
import { ProfitAndLoss } from './pages/reports/ProfitAndLoss';
import { BalanceSheet } from './pages/reports/BalanceSheet';
import { FinancialYears } from './pages/FinancialYears';
import { VoucherEdit } from './pages/vouchers/VoucherEdit';
import { ItemMaster } from './pages/inventory/ItemMaster';
import { InvoiceList } from './pages/invoices/InvoiceList';
import { InvoiceEntry } from './pages/invoices/InvoiceEntry';
import { InvoiceDetail } from './pages/invoices/InvoiceDetail';
import { RecurringInvoiceList } from './pages/invoices/RecurringInvoiceList';
import { RecurringInvoiceEntry } from './pages/invoices/RecurringInvoiceEntry';
import { GSTR1 } from './pages/reports/GSTR1';
import { GSTR3B } from './pages/reports/GSTR3B';
import { BackupRestore } from './pages/BackupRestore';
import { BankReconciliation } from './pages/banking/BankReconciliation';

function App() {
    return (
        <BrowserRouter>
            <Toaster position="top-right" />
            <AuthProvider>
                <Routes>
                    <Route element={<AuthLayout />}>
                        <Route path="/login" element={<Login />} />
                        <Route path="/register" element={<Register />} />
                    </Route>

                    <Route element={<MainLayout />}>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/companies" element={<CompanyList />} />
                        <Route path="/financial-years" element={<FinancialYears />} />
                        <Route path="/ledgers" element={<LedgerList />} />
                        <Route path="/ledgers/:ledgerId/statement" element={<LedgerStatement />} />
                        <Route path="/vouchers" element={<VoucherList />} />
                        <Route path="/vouchers/create" element={<VoucherEntry />} />
                        <Route path="/vouchers/edit/:id" element={<VoucherEdit />} />

                        {/* Inventory & Invoices */}
                        <Route path="/inventory/items" element={<ItemMaster />} />
                        <Route path="/invoices" element={<InvoiceList />} />
                        <Route path="/invoices/:id" element={<InvoiceDetail />} />
                        <Route path="/invoices/:id/edit" element={<InvoiceEntry />} />
                        <Route path="/invoices/create/sales" element={<InvoiceEntry type="SALES" />} />
                        <Route path="/invoices/create/purchase" element={<InvoiceEntry type="PURCHASE" />} />
                        <Route path="/invoices/create/credit-note" element={<InvoiceEntry type="CREDIT_NOTE" />} />
                        <Route path="/invoices/create/debit-note" element={<InvoiceEntry type="DEBIT_NOTE" />} />

                        {/* Recurring Invoices */}
                        <Route path="/recurring-invoices" element={<RecurringInvoiceList />} />
                        <Route path="/recurring-invoices/create" element={<RecurringInvoiceEntry />} />
                        <Route path="/recurring-invoices/:id/edit" element={<RecurringInvoiceEntry />} />

                        <Route path="/reports" element={<TrialBalance />} />
                        <Route path="/reports/profit-loss" element={<ProfitAndLoss />} />
                        <Route path="/reports/balance-sheet" element={<BalanceSheet />} />
                        <Route path="/reports/gstr-1" element={<GSTR1 />} />
                        <Route path="/reports/gstr-3b" element={<GSTR3B />} />
                        <Route path="/backup" element={<BackupRestore />} />
                        <Route path="/backup" element={<BackupRestore />} />
                        <Route path="/users" element={<Users />} />
                        <Route path="/banking/reconciliation" element={<BankReconciliation />} />
                        <Route path="/settings" element={<Settings />} />
                    </Route>

                    <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
