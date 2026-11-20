-- 0007 GST compliance: registration types, supply types, reverse charge, TDS, UQC

-- Party GST profile
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS gst_registration_type VARCHAR(20);  -- REGULAR, COMPOSITION, UNREGISTERED, CONSUMER, SEZ, OVERSEAS
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS pan VARCHAR(10);
UPDATE ledgers SET gst_registration_type = 'REGULAR' WHERE gst_registration_type IS NULL AND gstin IS NOT NULL AND gstin <> '';

-- GST unit quantity code (NOS, KGS, MTR...) for the HSN summary
ALTER TABLE units ADD COLUMN IF NOT EXISTS uqc VARCHAR(3);
-- Goods vs services (HSN vs SAC)
ALTER TABLE items ADD COLUMN IF NOT EXISTS item_type VARCHAR(10) NOT NULL DEFAULT 'GOODS';

-- Invoice GST attributes
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS supply_type VARCHAR(20) NOT NULL DEFAULT 'NORMAL'; -- NORMAL, SEZ_WPAY, SEZ_WOPAY, EXPORT_WPAY, EXPORT_WOPAY, DEEMED_EXPORT
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS shipping_bill_number VARCHAR(20);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS shipping_bill_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS port_code VARCHAR(10);

-- Income-tax TDS deducted on a purchase bill (party is paid net of TDS)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tds_section VARCHAR(10);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tds_rate DECIMAL(6, 3) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tds_amount DECIMAL(15, 2) NOT NULL DEFAULT 0;

-- GSTR-2B uploads for matching purchase bills
CREATE TABLE IF NOT EXISTS gstr2b_imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    return_period VARCHAR(6) NOT NULL,      -- MMYYYY
    file_name VARCHAR(255),
    documents JSONB NOT NULL,               -- normalised supplier documents
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, return_period)
);
