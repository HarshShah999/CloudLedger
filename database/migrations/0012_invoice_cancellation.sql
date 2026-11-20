-- 0012 Cancelling issued invoices instead of deleting them
-- A cancelled invoice keeps its number (GST requires the series to stay
-- complete), posts nothing, moves no stock and is reported as cancelled in
-- GSTR-1 Table 13 (documents issued).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_invoices_active ON invoices(company_id, type, date) WHERE status IS DISTINCT FROM 'CANCELLED';
