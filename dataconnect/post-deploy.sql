-- OPTIONAL hardening. Run ONCE after `firebase deploy --only dataconnect`, in Cloud SQL Studio (Google Cloud console
-- -> SQL -> your instance -> Cloud SQL Studio -> database shree_ram_dairy). Safe to re-run.
-- GraphQL cannot express CHECK constraints / triggers / trigram search, so they live here.
-- If a column name differs from what Studio shows (SQL Connect snake_cases field names), adjust it first.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  IF to_regclass('public.customers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS ix_customers_name_trgm ON customers USING gin (name gin_trgm_ops);     -- "contains" search
    CREATE INDEX IF NOT EXISTS ix_customers_low_balance ON customers (litres) WHERE type = 'prepaid' AND is_active;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_customers_nonneg') THEN
      ALTER TABLE customers ADD CONSTRAINT ck_customers_nonneg CHECK (litres >= 0 AND balance >= 0 AND due >= 0);
      ALTER TABLE customers ADD CONSTRAINT ck_customers_type CHECK (type IN ('prepaid','monthly'));
      ALTER TABLE customers ADD CONSTRAINT ck_customers_code CHECK (code ~ '^[A-Z0-9-]{3,20}$');
    END IF;
  END IF;
  IF to_regclass('public.bills') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bills_total') THEN
    ALTER TABLE bills ADD CONSTRAINT ck_bills_total CHECK (total >= 0);
    ALTER TABLE bills ADD CONSTRAINT ck_bills_mode CHECK (mode IN ('Cash','UPI','Card (Prepaid)'));
  END IF;
  IF to_regclass('public.bill_items') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bill_items_qty') THEN
    ALTER TABLE bill_items ADD CONSTRAINT ck_bill_items_qty CHECK (qty > 0 AND rate >= 0);
  END IF;
  IF to_regclass('public.stock_items') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_stock_nonneg') THEN
    ALTER TABLE stock_items ADD CONSTRAINT ck_stock_nonneg CHECK (qty >= 0);
  END IF;
  IF to_regclass('public.bookings') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_bookings_status') THEN
    ALTER TABLE bookings ADD CONSTRAINT ck_bookings_status CHECK (status IN ('Pending','Ready','Delivered','Cancelled'));
    ALTER TABLE bookings ADD CONSTRAINT ck_bookings_adv CHECK (advance >= 0 AND advance <= qty * rate);
  END IF;
  IF to_regclass('public.staff_entries') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_staff_entries_type') THEN
    ALTER TABLE staff_entries ADD CONSTRAINT ck_staff_entries_type CHECK (type IN ('absent','half','advance','product'));
  END IF;
  IF to_regclass('public.file_objects') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_files_size') THEN
    ALTER TABLE file_objects ADD CONSTRAINT ck_files_size CHECK (size_bytes IS NULL OR (size_bytes >= 0 AND size_bytes <= 20971520));
  END IF;
END $$;

-- The customer ledger is an audit trail: no edits, no deletes.
CREATE OR REPLACE FUNCTION forbid_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'customer_ledger is append-only'; END $$;
DO $$ BEGIN
  IF to_regclass('public.customer_ledger') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ledger_immutable ON customer_ledger;
    CREATE TRIGGER trg_ledger_immutable BEFORE UPDATE OR DELETE ON customer_ledger FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();
  END IF;
END $$;

-- Starter products (edit rates in the app afterwards)
INSERT INTO products (id, name, rate, unit, track_stock, is_active, sort_order) VALUES
  (gen_random_uuid(), 'दूध (Milk) 1L', 70, 'L', false, true, 1),
  (gen_random_uuid(), 'दही (Curd) 500g', 40, 'pack', true, true, 2),
  (gen_random_uuid(), 'पनीर (Paneer) 250g', 100, 'pack', true, true, 3),
  (gen_random_uuid(), 'घी (Ghee) 500g', 350, 'pack', true, true, 4),
  (gen_random_uuid(), 'छाछ (Buttermilk) 1L', 20, 'L', true, true, 5)
ON CONFLICT (name) DO NOTHING;
