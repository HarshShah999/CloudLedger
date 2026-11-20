-- 0008 E-invoice, e-way bill and automatic payment reminders

-- Addresses need city and PIN for e-invoice / e-way bill
ALTER TABLE companies ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pincode VARCHAR(6);
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS pincode VARCHAR(6);

-- E-invoicing is mandatory above an aggregate turnover threshold; the company opts in
ALTER TABLE companies ADD COLUMN IF NOT EXISTS einvoice_enabled BOOLEAN NOT NULL DEFAULT false;

-- E-invoice (IRN) details returned by the IRP
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS irn VARCHAR(64);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS irn_ack_no VARCHAR(20);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS irn_ack_date TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS irn_signed_qr TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS irn_status VARCHAR(10);  -- ACTIVE, CANCELLED
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_irn ON invoices(irn) WHERE irn IS NOT NULL;

-- Transport and e-way bill
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transport_mode VARCHAR(10);      -- ROAD, RAIL, AIR, SHIP
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transport_distance_km INTEGER;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(20);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transporter_id VARCHAR(15);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transporter_name VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transport_doc_number VARCHAR(20);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transport_doc_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ewb_number VARCHAR(12);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ewb_date TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ewb_valid_until TIMESTAMP;

-- Automatic payment reminders
ALTER TABLE companies ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT false;
-- Days relative to the due date: negative = before, 0 = on the day, positive = after
ALTER TABLE companies ADD COLUMN IF NOT EXISTS reminder_days VARCHAR(50) NOT NULL DEFAULT '-3,0,7,15,30';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS reminder_channels VARCHAR(30) NOT NULL DEFAULT 'EMAIL';
-- WhatsApp Business Cloud API (Meta); the token is stored encrypted
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id VARCHAR(30);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_token_enc TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_template VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_template_lang VARCHAR(10) NOT NULL DEFAULT 'en';

CREATE TABLE IF NOT EXISTS reminder_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    day_offset INTEGER NOT NULL,
    channel VARCHAR(10) NOT NULL,
    status VARCHAR(10) NOT NULL,            -- SENT, FAILED, SKIPPED
    detail TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (invoice_id, day_offset, channel)
);
