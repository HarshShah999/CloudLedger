-- 0005 Invoice branding: logo, signature, brand colour, print copies

-- Images live in their own table so audit_log rows don't carry image bytes
CREATE TABLE IF NOT EXISTS company_assets (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL,          -- logo, signature
    mime VARCHAR(30) NOT NULL,
    data BYTEA NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (company_id, kind)
);

ALTER TABLE companies ADD COLUMN IF NOT EXISTS brand_color VARCHAR(7) NOT NULL DEFAULT '#4338CA';
-- Print "Original for Recipient / Duplicate for Transporter / Triplicate for Supplier" on GST invoices
ALTER TABLE companies ADD COLUMN IF NOT EXISTS print_copy_labels BOOLEAN NOT NULL DEFAULT true;
