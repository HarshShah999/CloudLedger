-- 0002 Integrity & tenancy hardening

-- Platform super-admin (can run full-database backup/restore). Company-level
-- permissions come from company_users.role, never from users.role.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT false;
UPDATE users SET is_superadmin = true
WHERE id = (
    SELECT id FROM users
    ORDER BY (role = 'admin') DESC, created_at ASC
    LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM users WHERE is_superadmin);

-- Party contact details (used by invoices, email and WhatsApp sharing)
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS address TEXT;

-- System codes identify the ledgers/groups the posting engine relies on
-- (tax ledgers, round-off, debtors...) instead of guessing by name.
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS code VARCHAR(50);
ALTER TABLE ledger_groups ADD COLUMN IF NOT EXISTS code VARCHAR(50);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledgers_company_code
    ON ledgers(company_id, code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_groups_company_code
    ON ledger_groups(company_id, code) WHERE code IS NOT NULL;

-- Company accounting preferences
ALTER TABLE companies ADD COLUMN IF NOT EXISTS round_off_invoices BOOLEAN NOT NULL DEFAULT true;

-- Invoices: financial year, place of supply and rounding
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS financial_year_id UUID REFERENCES financial_years(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS place_of_supply VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS round_off DECIMAL(15, 2) NOT NULL DEFAULT 0.00;

-- Payments: which cash/bank ledger received or paid the money
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deposit_ledger_id UUID REFERENCES ledgers(id) ON DELETE SET NULL;

-- Backfill financial year on vouchers and invoices from their dates
UPDATE vouchers v SET financial_year_id = fy.id
FROM financial_years fy
WHERE v.financial_year_id IS NULL
  AND fy.company_id = v.company_id
  AND v.date BETWEEN fy.start_date AND fy.end_date;

UPDATE invoices i SET financial_year_id = fy.id
FROM financial_years fy
WHERE i.financial_year_id IS NULL
  AND fy.company_id = i.company_id
  AND i.date BETWEEN fy.start_date AND fy.end_date;

-- Document number series (per company, document type and financial year)
CREATE TABLE IF NOT EXISTS number_series (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    doc_type VARCHAR(30) NOT NULL,
    financial_year_id UUID REFERENCES financial_years(id) ON DELETE CASCADE,
    prefix VARCHAR(20) NOT NULL DEFAULT '',
    next_number INTEGER NOT NULL DEFAULT 1,
    padding INTEGER NOT NULL DEFAULT 4,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_number_series
    ON number_series(company_id, doc_type, COALESCE(financial_year_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Invoice numbers must be unique per company, type and financial year (GST rule).
-- Only enforced when existing data allows it, so the migration never fails on old data.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM invoices
        GROUP BY company_id, type, financial_year_id, lower(invoice_number)
        HAVING COUNT(*) > 1
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_number
            ON invoices(company_id, type, COALESCE(financial_year_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(invoice_number));
    ELSE
        RAISE NOTICE 'Duplicate invoice numbers exist; uq_invoice_number not created';
    END IF;
END $$;

-- Voucher entry sanity (enforced for new rows; existing rows are not re-checked)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_voucher_entries_type') THEN
        ALTER TABLE voucher_entries ADD CONSTRAINT chk_voucher_entries_type CHECK (type IN ('Dr', 'Cr')) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_voucher_entries_amount') THEN
        ALTER TABLE voucher_entries ADD CONSTRAINT chk_voucher_entries_amount CHECK (amount > 0) NOT VALID;
    END IF;
END $$;

-- Deleting a ledger must never silently delete its accounting entries.
ALTER TABLE voucher_entries DROP CONSTRAINT IF EXISTS voucher_entries_ledger_id_fkey;
ALTER TABLE voucher_entries ADD CONSTRAINT voucher_entries_ledger_id_fkey
    FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE RESTRICT;

-- Every company gets the full set of standard voucher types
INSERT INTO voucher_types (company_id, name)
SELECT c.id, t.name
FROM companies c
CROSS JOIN (VALUES ('Sales'), ('Purchase'), ('Payment'), ('Receipt'), ('Journal'),
                   ('Contra'), ('Credit Note'), ('Debit Note')) AS t(name)
WHERE NOT EXISTS (
    SELECT 1 FROM voucher_types vt WHERE vt.company_id = c.id AND vt.name = t.name
);

CREATE INDEX IF NOT EXISTS idx_vouchers_company_date ON vouchers(company_id, date);
CREATE INDEX IF NOT EXISTS idx_entries_voucher ON voucher_entries(voucher_id);
CREATE INDEX IF NOT EXISTS idx_company_users_user ON company_users(user_id);

-- Recurring invoices: a readable profile name and per-line tax rate
ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS profile_name VARCHAR(255);
ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS last_generated_at TIMESTAMP;
ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE recurring_invoice_items ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5, 2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recurring_invoice_id UUID REFERENCES recurring_invoices(id) ON DELETE SET NULL;
