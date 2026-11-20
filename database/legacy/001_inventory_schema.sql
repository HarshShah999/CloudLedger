-- Units Table
CREATE TABLE units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL, -- e.g., "Kilogram", "Pieces"
    symbol VARCHAR(10) NOT NULL, -- e.g., "kg", "pcs"
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, name)
);

-- Items Table (Products/Services)
CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    hsn_code VARCHAR(20),
    unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    tax_rate DECIMAL(5, 2) DEFAULT 0.00, -- GST Rate (e.g., 18.00)
    sales_rate DECIMAL(15, 2) DEFAULT 0.00,
    purchase_rate DECIMAL(15, 2) DEFAULT 0.00,
    opening_quantity DECIMAL(15, 3) DEFAULT 0.000,
    current_quantity DECIMAL(15, 3) DEFAULT 0.000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoices Table
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    voucher_id UUID REFERENCES vouchers(id) ON DELETE CASCADE, -- Link to accounting
    party_ledger_id UUID REFERENCES ledgers(id) ON DELETE SET NULL,
    sales_ledger_id UUID REFERENCES ledgers(id) ON DELETE SET NULL, -- Sales or Purchase Account
    invoice_number VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    due_date DATE,
    type VARCHAR(20) NOT NULL, -- 'SALES' or 'PURCHASE'
    subtotal DECIMAL(15, 2) DEFAULT 0.00,
    tax_total DECIMAL(15, 2) DEFAULT 0.00,
    grand_total DECIMAL(15, 2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoice Items (Line Items)
CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    description TEXT,
    quantity DECIMAL(15, 3) NOT NULL,
    rate DECIMAL(15, 2) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL, -- qty * rate
    tax_rate DECIMAL(5, 2) DEFAULT 0.00,
    tax_amount DECIMAL(15, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_items_company ON items(company_id);
CREATE INDEX idx_invoices_company ON invoices(company_id);
CREATE INDEX idx_invoices_voucher ON invoices(voucher_id);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);
