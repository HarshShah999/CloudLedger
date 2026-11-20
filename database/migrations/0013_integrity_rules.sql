-- 0013 Integrity rules enforced by the database itself, not only by the app.
-- Each rule is applied only when existing data already satisfies it, so the
-- migration never fails on an old database; a NOTICE names anything skipped.

-- 1. Every business record belongs to a company
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['company_users', 'financial_years', 'invoices', 'items', 'ledger_groups', 'ledgers',
                             'payments', 'recurring_invoices', 'units', 'voucher_types', 'vouchers'] LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'company_id' AND is_nullable = 'YES') THEN
            BEGIN
                EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET NOT NULL', t);
            EXCEPTION WHEN not_null_violation THEN
                RAISE NOTICE '%.company_id has empty values; left nullable', t;
            END;
        END IF;
    END LOOP;
END $$;

-- 2. No two ledgers, items, groups or units with the same name in a company
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('ledgers', 'uq_ledgers_company_name', 'lower(name)'),
        ('items', 'uq_items_company_name', 'lower(name)'),
        ('ledger_groups', 'uq_ledger_groups_company_name', 'lower(name)'),
        ('units', 'uq_units_company_symbol', 'lower(symbol)')
    ) AS v(tbl, idx, expr) LOOP
        BEGIN
            EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (company_id, %s)', r.idx, r.tbl, r.expr);
        EXCEPTION WHEN unique_violation THEN
            RAISE NOTICE '% has duplicate names; % not created', r.tbl, r.idx;
        END;
    END LOOP;
END $$;

-- 3. Debits must equal credits, and match the voucher total, checked when the
--    transaction commits (entries are written one by one inside it)
CREATE OR REPLACE FUNCTION check_voucher_balanced() RETURNS trigger AS $$
DECLARE
    v_id UUID := COALESCE(NEW.voucher_id, OLD.voucher_id);
    dr NUMERIC;
    cr NUMERIC;
    total NUMERIC;
BEGIN
    SELECT total_amount INTO total FROM vouchers WHERE id = v_id;
    IF NOT FOUND THEN RETURN NULL; END IF; -- voucher deleted with its entries
    SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'Dr'), 0), COALESCE(SUM(amount) FILTER (WHERE type = 'Cr'), 0)
      INTO dr, cr FROM voucher_entries WHERE voucher_id = v_id;
    IF dr <> cr THEN
        RAISE EXCEPTION 'Voucher % is not balanced: debit % <> credit %', v_id, dr, cr USING ERRCODE = 'check_violation';
    END IF;
    IF dr > 0 AND total IS DISTINCT FROM dr THEN
        RAISE EXCEPTION 'Voucher % total % does not match its entries (%)', v_id, total, dr USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_voucher_balanced ON voucher_entries;
CREATE CONSTRAINT TRIGGER trg_voucher_balanced
    AFTER INSERT OR UPDATE OR DELETE ON voucher_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_voucher_balanced();

-- 4. Checks added earlier as NOT VALID (to tolerate old data) are validated where possible
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint WHERE contype = 'c' AND NOT convalidated LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tbl, r.conname);
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'Existing rows break %.%; kept for new rows only', r.tbl, r.conname;
        END;
    END LOOP;
END $$;

-- 5. Timestamps carry their time zone (values written so far are in the server's zone)
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT table_name, column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND data_type = 'timestamp without time zone' LOOP
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE current_setting(''TimeZone'')',
                       r.table_name, r.column_name, r.column_name);
    END LOOP;
END $$;

-- 6. Reports filter by company and date
CREATE INDEX IF NOT EXISTS idx_invoices_company_date ON invoices(company_id, date);
CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(company_id, party_ledger_id);
CREATE INDEX IF NOT EXISTS idx_voucher_entries_ledger_voucher ON voucher_entries(ledger_id, voucher_id);
CREATE INDEX IF NOT EXISTS idx_payments_receipt_invoice ON payments(invoice_id, receipt_id);
