-- 0009 Imports: remember where imported vouchers came from so re-imports skip them

ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_external_id ON vouchers(company_id, external_id) WHERE external_id IS NOT NULL;
