-- 0011 Stock movements and valuation
--
-- Every change in stock is a row here: purchases and sales returns add,
-- sales and purchase returns remove. Opening stock lives on the item
-- (opening_quantity x opening_rate). Closing stock is valued at weighted
-- average cost from these rows, and items.current_quantity is kept equal to
-- opening + movements by a trigger, so it can never drift.

ALTER TABLE items ADD COLUMN IF NOT EXISTS opening_rate DECIMAL(15, 4) NOT NULL DEFAULT 0;
-- Existing items: the purchase rate is the best available estimate of the opening cost
UPDATE items SET opening_rate = COALESCE(purchase_rate, 0) WHERE opening_rate = 0 AND opening_quantity > 0;

CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    quantity DECIMAL(15, 3) NOT NULL CHECK (quantity <> 0), -- positive = in, negative = out
    value DECIMAL(15, 2),                                  -- cost of goods coming in; NULL = valued at average cost
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(company_id, item_id, date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_invoice ON stock_movements(invoice_id);

-- Backfill from existing posted bills
INSERT INTO stock_movements (company_id, item_id, invoice_id, date, quantity, value)
SELECT i.company_id, ii.item_id, i.id, i.date,
       CASE WHEN i.type IN ('PURCHASE', 'CREDIT_NOTE') THEN ii.quantity ELSE -ii.quantity END,
       CASE WHEN i.type = 'PURCHASE' THEN ii.taxable_amount END
FROM invoice_items ii
JOIN invoices i ON i.id = ii.invoice_id
JOIN items it ON it.id = ii.item_id
WHERE i.type IN ('SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE')
  AND NOT i.is_opening AND COALESCE(it.item_type, 'GOODS') = 'GOODS' AND ii.quantity <> 0
  AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.invoice_id = i.id);

CREATE OR REPLACE FUNCTION refresh_item_quantity(p_item UUID) RETURNS void AS $$
    UPDATE items SET current_quantity = opening_quantity +
        COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE item_id = p_item), 0)
    WHERE id = p_item;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION trg_stock_movement_qty() RETURNS trigger AS $$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM refresh_item_quantity(NEW.item_id); END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') THEN PERFORM refresh_item_quantity(OLD.item_id); END IF;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_movement_qty ON stock_movements;
CREATE TRIGGER trg_stock_movement_qty AFTER INSERT OR UPDATE OR DELETE ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION trg_stock_movement_qty();

CREATE OR REPLACE FUNCTION trg_item_opening_qty() RETURNS trigger AS $$
BEGIN
    IF NEW.opening_quantity IS DISTINCT FROM OLD.opening_quantity THEN PERFORM refresh_item_quantity(NEW.id); END IF;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_item_opening_qty ON items;
CREATE TRIGGER trg_item_opening_qty AFTER UPDATE OF opening_quantity ON items
    FOR EACH ROW EXECUTE FUNCTION trg_item_opening_qty();

-- Bring every item's quantity in line with its movements
UPDATE items it SET current_quantity = it.opening_quantity +
    COALESCE((SELECT SUM(quantity) FROM stock_movements sm WHERE sm.item_id = it.id), 0);
