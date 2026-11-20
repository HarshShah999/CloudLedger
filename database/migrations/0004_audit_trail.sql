-- 0004 Audit trail (edit log)
--
-- Companies (Accounts) Rules, 2014, Rule 3(1) (from 1 April 2023): books kept
-- electronically must record an audit trail of every change, and the audit
-- trail must not be disabled. This is enforced in the database itself:
--   * row-level triggers on every accounting table record each INSERT/UPDATE/DELETE
--     with the before/after values, the user and the time;
--   * the audit_log table is append-only (UPDATE, DELETE and TRUNCATE are refused).

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    company_id UUID,
    table_name VARCHAR(63) NOT NULL,
    record_id UUID,
    action VARCHAR(6) NOT NULL,              -- INSERT, UPDATE, DELETE
    old_data JSONB,
    new_data JSONB,
    changed_fields TEXT[],
    user_id UUID,
    ip_address VARCHAR(64),
    txid BIGINT NOT NULL DEFAULT txid_current(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_audit_company_time ON audit_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_log(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_txid ON audit_log(txid);

-- Append-only
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

DROP TRIGGER IF EXISTS trg_audit_log_no_truncate ON audit_log;
CREATE TRIGGER trg_audit_log_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- Generic row auditor. The application sets app.user_id / app.ip for the
-- transaction with set_config(..., true); changes made outside the app
-- (e.g. directly in psql) are still logged, with user_id NULL.
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger AS $$
DECLARE
    old_j JSONB;
    new_j JSONB;
    rec JSONB;
    cid UUID;
    fields TEXT[];
    uid TEXT := NULLIF(current_setting('app.user_id', true), '');
BEGIN
    IF TG_OP <> 'INSERT' THEN old_j := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN new_j := to_jsonb(NEW); END IF;
    rec := COALESCE(new_j, old_j);

    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(k ORDER BY k) INTO fields
        FROM jsonb_object_keys(new_j) AS k
        WHERE new_j -> k IS DISTINCT FROM old_j -> k;
        IF fields IS NULL THEN RETURN NULL; END IF;  -- nothing actually changed
    END IF;

    -- Resolve the company for child tables
    IF rec ? 'company_id' THEN
        cid := (rec ->> 'company_id')::uuid;
    ELSIF TG_TABLE_NAME = 'companies' THEN
        cid := (rec ->> 'id')::uuid;
    ELSIF TG_TABLE_NAME = 'voucher_entries' THEN
        SELECT company_id INTO cid FROM vouchers WHERE id = (rec ->> 'voucher_id')::uuid;
    ELSIF TG_TABLE_NAME = 'invoice_items' THEN
        SELECT company_id INTO cid FROM invoices WHERE id = (rec ->> 'invoice_id')::uuid;
    END IF;

    -- Never store password hashes or document-share tokens in the log
    old_j := old_j - 'password' - 'token_hash';
    new_j := new_j - 'password' - 'token_hash';

    INSERT INTO audit_log (company_id, table_name, record_id, action, old_data, new_data, changed_fields, user_id, ip_address)
    VALUES (cid, TG_TABLE_NAME, (rec ->> 'id')::uuid, TG_OP, old_j, new_j, fields,
            CASE WHEN uid ~ '^[0-9a-fA-F-]{36}$' THEN uid::uuid END,
            NULLIF(current_setting('app.ip', true), ''));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'companies', 'company_users', 'financial_years', 'ledger_groups', 'ledgers', 'voucher_types',
        'vouchers', 'voucher_entries', 'invoices', 'invoice_items', 'payments', 'items', 'units',
        'recurring_invoices', 'number_series'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit ON %I', t);
        EXECUTE format('CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON %I
                        FOR EACH ROW EXECUTE FUNCTION audit_row()', t);
    END LOOP;
END $$;
