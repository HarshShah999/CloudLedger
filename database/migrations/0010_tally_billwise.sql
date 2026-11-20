-- 0010 Fuller Tally import: GST invoices from Tally vouchers, bill-wise details, custom voucher types

-- Unpaid bills brought forward from another system (e.g. Tally's opening bill-wise
-- balances). They carry no voucher (the amount is already in the party's opening
-- balance), move no stock and never appear in GST returns.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_opening BOOLEAN NOT NULL DEFAULT false;

-- The bill reference used for bill-wise settlement (Tally's "New Ref" name).
-- Usually the invoice number; for purchases often our own voucher number.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bill_ref VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_invoices_bill_ref ON invoices(company_id, party_ledger_id, lower(bill_ref));

-- Which GST head a tax ledger carries (CGST, SGST, IGST, CESS), from Tally's GST duty head
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS gst_tax_head VARCHAR(10);

-- Tally voucher types (e.g. "Sales GST" under "Sales"), so Day Book files imported
-- later can be filed under the right base type
CREATE TABLE IF NOT EXISTS imported_voucher_types (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    parent VARCHAR(100) NOT NULL,
    PRIMARY KEY (company_id, name)
);

-- Invoice numbers: unique per company, type and financial year, except that
-- purchase bill numbers are the supplier's own and only need to be unique per
-- supplier. Opening bills are brought-forward references and are not checked.
DROP INDEX IF EXISTS uq_invoice_number;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM invoices WHERE NOT is_opening
        GROUP BY company_id, type, financial_year_id, lower(invoice_number),
                 CASE WHEN type = 'PURCHASE' THEN party_ledger_id END
        HAVING COUNT(*) > 1
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_number ON invoices(
            company_id, type,
            COALESCE(financial_year_id, '00000000-0000-0000-0000-000000000000'::uuid),
            lower(invoice_number),
            COALESCE(CASE WHEN type = 'PURCHASE' THEN party_ledger_id END, '00000000-0000-0000-0000-000000000000'::uuid)
        ) WHERE NOT is_opening;
    ELSE
        RAISE NOTICE 'Duplicate invoice numbers exist; uq_invoice_number not created';
    END IF;
END $$;
