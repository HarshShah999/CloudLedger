-- 0003 Sharing: public document links, payment details, message templates, communication log

-- Company details printed on invoices and used when sharing
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pan VARCHAR(10);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS upi_id VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_name VARCHAR(150);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_account_name VARCHAR(150);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(40);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(20);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_branch VARCHAR(150);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS invoice_terms TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS share_message_template TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS share_link_days INTEGER NOT NULL DEFAULT 30;

-- Secure, expiring public links to a document (invoice, ledger statement...).
-- Only a SHA-256 hash of the token is stored; the token itself is shown once.
CREATE TABLE IF NOT EXISTS document_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    doc_type VARCHAR(30) NOT NULL,            -- INVOICE, LEDGER_STATEMENT
    doc_id UUID NOT NULL,
    params JSONB NOT NULL DEFAULT '{}'::jsonb, -- e.g. statement period
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    view_count INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMP,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_shares_doc ON document_shares(doc_type, doc_id);

-- Every time a document is sent or shared, on any channel
CREATE TABLE IF NOT EXISTS communication_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    doc_type VARCHAR(30) NOT NULL,
    doc_id UUID NOT NULL,
    channel VARCHAR(20) NOT NULL,             -- EMAIL, WHATSAPP, LINK, NATIVE, DOWNLOAD, PRINT
    recipient VARCHAR(255),
    subject TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'SENT',
    error TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_communication_logs_doc ON communication_logs(doc_type, doc_id);

-- Keep the history from the old email log
INSERT INTO communication_logs (company_id, doc_type, doc_id, channel, recipient, subject, status, created_at)
SELECT i.company_id, 'INVOICE', e.invoice_id, 'EMAIL', e.recipient, e.subject, e.status, e.sent_at
FROM email_logs e JOIN invoices i ON i.id = e.invoice_id
WHERE NOT EXISTS (SELECT 1 FROM communication_logs);
