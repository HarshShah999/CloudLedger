-- 0001 Baseline
-- Consolidates database/legacy/schema.sql, the legacy migrations and the ad-hoc
-- server/src/scripts/add_*.ts column additions into one idempotent script.
-- Safe to run on a fresh database AND on an existing CloudLedger database.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'viewer',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Companies -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    email VARCHAR(255),
    phone VARCHAR(50),
    currency VARCHAR(10) DEFAULT 'INR',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin VARCHAR(20);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS state VARCHAR(100);

CREATE TABLE IF NOT EXISTS company_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'viewer',
    UNIQUE(company_id, user_id)
);

-- Financial years -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE financial_years ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT false;

-- Chart of accounts ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES ledger_groups(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ledgers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    group_id UUID REFERENCES ledger_groups(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    opening_balance DECIMAL(15, 2) DEFAULT 0.00,
    opening_balance_type VARCHAR(10) DEFAULT 'Dr',
    current_balance DECIMAL(15, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS gstin VARCHAR(20);
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS state VARCHAR(100);

-- Vouchers ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voucher_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vouchers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    financial_year_id UUID REFERENCES financial_years(id) ON DELETE SET NULL,
    voucher_type_id UUID REFERENCES voucher_types(id) ON DELETE SET NULL,
    voucher_number VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    narration TEXT,
    total_amount DECIMAL(15, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS voucher_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    voucher_id UUID REFERENCES vouchers(id) ON DELETE CASCADE,
    ledger_id UUID REFERENCES ledgers(id) ON DELETE CASCADE,
    amount DECIMAL(15, 2) NOT NULL,
    type VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE voucher_entries ADD COLUMN IF NOT EXISTS instrument_number VARCHAR(50);
ALTER TABLE voucher_entries ADD COLUMN IF NOT EXISTS instrument_date DATE;
ALTER TABLE voucher_entries ADD COLUMN IF NOT EXISTS bank_allocation_date DATE;

CREATE INDEX IF NOT EXISTS idx_vouchers_company ON vouchers(company_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(date);
CREATE INDEX IF NOT EXISTS idx_entries_ledger ON voucher_entries(ledger_id);
CREATE INDEX IF NOT EXISTS idx_ledgers_company ON ledgers(company_id);

-- Inventory -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    hsn_code VARCHAR(50),
    unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    tax_rate DECIMAL(5, 2) DEFAULT 0.00,
    sales_rate DECIMAL(15, 2) DEFAULT 0.00,
    purchase_rate DECIMAL(15, 2) DEFAULT 0.00,
    opening_quantity DECIMAL(15, 3) DEFAULT 0.000,
    current_quantity DECIMAL(15, 3) DEFAULT 0.000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE items ADD COLUMN IF NOT EXISTS description TEXT;
CREATE INDEX IF NOT EXISTS idx_items_company ON items(company_id);

-- Invoices ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL,
    party_ledger_id UUID REFERENCES ledgers(id) ON DELETE SET NULL,
    sales_ledger_id UUID REFERENCES ledgers(id) ON DELETE SET NULL,
    invoice_number VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    due_date DATE,
    type VARCHAR(20) NOT NULL,
    subtotal DECIMAL(15, 2) DEFAULT 0.00,
    tax_total DECIMAL(15, 2) DEFAULT 0.00,
    grand_total DECIMAL(15, 2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS outstanding_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'UNPAID';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS original_invoice_number VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS original_invoice_date DATE;

CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    description TEXT,
    quantity DECIMAL(15, 3) DEFAULT 0.000,
    rate DECIMAL(15, 2) DEFAULT 0.00,
    amount DECIMAL(15, 2) DEFAULT 0.00,
    tax_rate DECIMAL(5, 2) DEFAULT 0.00,
    tax_amount DECIMAL(15, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cgst_rate DECIMAL(5, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cgst_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS sgst_rate DECIMAL(5, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS sgst_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS igst_rate DECIMAL(5, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS igst_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS taxable_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS total_amount DECIMAL(15, 2) DEFAULT 0.00;

CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
CREATE INDEX IF NOT EXISTS idx_invoices_voucher ON invoices(voucher_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- Payments ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL,
    payment_date DATE NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    payment_mode VARCHAR(50),
    reference_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id);

-- Communication -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    recipient VARCHAR(255) NOT NULL,
    cc VARCHAR(255),
    subject TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'SENT'
);
CREATE INDEX IF NOT EXISTS idx_email_logs_invoice ON email_logs(invoice_id);

-- Recurring invoices --------------------------------------------------------
CREATE TABLE IF NOT EXISTS recurring_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    party_ledger_id UUID REFERENCES ledgers(id),
    sales_ledger_id UUID REFERENCES ledgers(id),
    type VARCHAR(20) NOT NULL,
    frequency VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    next_invoice_date DATE NOT NULL,
    invoice_number_prefix VARCHAR(50),
    discount_percent DECIMAL(5, 2) DEFAULT 0.00,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recurring_invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recurring_invoice_id UUID REFERENCES recurring_invoices(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id),
    description TEXT,
    quantity DECIMAL(15, 3) NOT NULL,
    rate DECIMAL(15, 2) NOT NULL,
    discount_percent DECIMAL(5, 2) DEFAULT 0.00
);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_next_date ON recurring_invoices(next_invoice_date);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_active ON recurring_invoices(is_active);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_company ON recurring_invoices(company_id);

-- Backups -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backup_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(20) NOT NULL,
    filename VARCHAR(255),
    file_size BIGINT,
    status VARCHAR(20) DEFAULT 'SUCCESS',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    error_message TEXT,
    storage_location VARCHAR(50) DEFAULT 'local',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS restore_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    backup_filename VARCHAR(255),
    type VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'SUCCESS',
    restored_by UUID REFERENCES users(id) ON DELETE SET NULL,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_backup_logs_created ON backup_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_backup_logs_type ON backup_logs(type);
CREATE INDEX IF NOT EXISTS idx_backup_logs_status ON backup_logs(status);
CREATE INDEX IF NOT EXISTS idx_restore_logs_created ON restore_logs(created_at);
