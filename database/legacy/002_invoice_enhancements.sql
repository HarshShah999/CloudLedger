-- Enhanced GST Support Migration

-- Add GSTIN and State to Companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin VARCHAR(15);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS state VARCHAR(50);

-- Add GSTIN and State to Ledgers (for party details)
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS gstin VARCHAR(15);
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS state VARCHAR(50);

-- Update invoice_items to support CGST/SGST/IGST split
-- Note: We already have these fields from the previous migration, but ensuring they exist
ALTER TABLE invoice_items DROP COLUMN IF EXISTS cgst_rate CASCADE;
ALTER TABLE invoice_items DROP COLUMN IF EXISTS cgst_amount CASCADE;
ALTER TABLE invoice_items DROP COLUMN IF EXISTS sgst_rate CASCADE;
ALTER TABLE invoice_items DROP COLUMN IF EXISTS sgst_amount CASCADE;
ALTER TABLE invoice_items DROP COLUMN IF EXISTS igst_rate CASCADE;
ALTER TABLE invoice_items DROP COLUMN IF EXISTS igst_amount CASCADE;

-- Re-add with correct structure
ALTER TABLE invoice_items ADD COLUMN cgst_rate DECIMAL(5, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN cgst_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN sgst_rate DECIMAL(5, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN sgst_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN igst_rate DECIMAL(5, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN igst_amount DECIMAL(15, 2) DEFAULT 0.00;

-- Add discount support to invoice_items
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS taxable_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS total_amount DECIMAL(15, 2) DEFAULT 0.00;

-- Add discount support to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15, 2) DEFAULT 0.00;

-- Add payment tracking to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS outstanding_amount DECIMAL(15, 2) DEFAULT 0.00;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'UNPAID'; -- UNPAID, PARTIAL, PAID

-- Create payments table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL,
    payment_date DATE NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    payment_mode VARCHAR(50), -- Cash, Bank, Cheque, UPI, etc.
    reference_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id);
