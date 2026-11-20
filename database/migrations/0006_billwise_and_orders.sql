-- 0006 Bill-wise settlement, advances, and quotation / order documents

-- A receipt (money in) or payment (money out) for a party. It can be split
-- across several invoices (rows in `payments`); whatever is not allocated
-- stays on account as an advance and can be allocated later.
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    party_ledger_id UUID NOT NULL REFERENCES ledgers(id),
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('RECEIPT', 'PAYMENT')),
    date DATE NOT NULL,
    amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
    deposit_ledger_id UUID NOT NULL REFERENCES ledgers(id),
    payment_mode VARCHAR(50),
    reference_number VARCHAR(100),
    notes TEXT,
    voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_receipts_party ON receipts(company_id, party_ledger_id);

-- Allocations of a receipt to invoices reuse the payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES receipts(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_payments_receipt ON payments(receipt_id);

-- Quotations and orders live in the invoices table but never post to the books
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status VARCHAR(20);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS valid_until DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_source ON invoices(source_document_id);

-- Audit the new tables
DROP TRIGGER IF EXISTS trg_audit ON receipts;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION audit_row();
