-- Units Table
CREATE TABLE IF NOT EXISTS units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, name)
);

-- Items Table (Products/Services)
CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    hsn_code VARCHAR(50),
    unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    description TEXT,
    tax_rate DECIMAL(5, 2) DEFAULT 0.00,
    sales_rate DECIMAL(15, 2) DEFAULT 0.00,
    purchase_rate DECIMAL(15, 2) DEFAULT 0.00,
    opening_quantity DECIMAL(15, 3) DEFAULT 0.000,
    current_quantity DECIMAL(15, 3) DEFAULT 0.000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoices Table (Document Header)
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL, -- Link to accounting voucher
    party_ledger_id UUID REFERENCES ledgers(id) ON DELETE SET NULL,
    sales_ledger_id UUID REFERENCES ledgers(id) ON DELETE SET NULL,
    invoice_number VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    due_date DATE,
    type VARCHAR(20) NOT NULL, -- SALES or PURCHASE
    subtotal DECIMAL(15, 2) DEFAULT 0.00,
    tax_total DECIMAL(15, 2) DEFAULT 0.00,
    grand_total DECIMAL(15, 2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoice Items (Line items)
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_items_company ON items(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
