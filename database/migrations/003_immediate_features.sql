-- Migration for Immediate Priority Features

-- Email logging
CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    recipient VARCHAR(255) NOT NULL,
    cc VARCHAR(255),
    subject TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'SENT' -- SENT, FAILED
);

-- Recurring invoices
CREATE TABLE IF NOT EXISTS recurring_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    party_ledger_id UUID REFERENCES ledgers(id),
    sales_ledger_id UUID REFERENCES ledgers(id),
    type VARCHAR(20) NOT NULL, -- SALES, PURCHASE
    frequency VARCHAR(20) NOT NULL, -- MONTHLY, QUARTERLY, YEARLY
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_logs_invoice ON email_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_next_date ON recurring_invoices(next_invoice_date);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_active ON recurring_invoices(is_active);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_company ON recurring_invoices(company_id);
