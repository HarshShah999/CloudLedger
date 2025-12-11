-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'viewer', -- admin, accountant, viewer
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Companies Table
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    email VARCHAR(255),
    phone VARCHAR(50),
    currency VARCHAR(10) DEFAULT 'INR',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Company Users (Many-to-Many)
CREATE TABLE company_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'viewer',
    UNIQUE(company_id, user_id)
);

-- Financial Years
CREATE TABLE financial_years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL, -- e.g., "2024-2025"
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ledger Groups
CREATE TABLE ledger_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES ledger_groups(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL, -- Asset, Liability, Income, Expense
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ledgers
CREATE TABLE ledgers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    group_id UUID REFERENCES ledger_groups(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    opening_balance DECIMAL(15, 2) DEFAULT 0.00,
    opening_balance_type VARCHAR(10) DEFAULT 'Dr', -- Dr or Cr
    current_balance DECIMAL(15, 2) DEFAULT 0.00, -- Cached balance
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Voucher Types
CREATE TABLE voucher_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL, -- Sales, Purchase, Payment, Receipt, Journal
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vouchers (Header)
CREATE TABLE vouchers (
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

-- Voucher Entries (Line Items)
CREATE TABLE voucher_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    voucher_id UUID REFERENCES vouchers(id) ON DELETE CASCADE,
    ledger_id UUID REFERENCES ledgers(id) ON DELETE CASCADE,
    amount DECIMAL(15, 2) NOT NULL,
    type VARCHAR(10) NOT NULL, -- Dr or Cr
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_vouchers_company ON vouchers(company_id);
CREATE INDEX idx_vouchers_date ON vouchers(date);
CREATE INDEX idx_entries_ledger ON voucher_entries(ledger_id);
CREATE INDEX idx_ledgers_company ON ledgers(company_id);
