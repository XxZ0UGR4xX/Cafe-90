-- 007: Facturación electrónica México (CFDI 4.0)
ALTER TABLE branches ADD COLUMN postal_code text CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{5}$');

-- Claves SAT por producto (por defecto: servicios de restaurante, pieza)
ALTER TABLE products
  ADD COLUMN sat_product_key text NOT NULL DEFAULT '90101501' CHECK (sat_product_key ~ '^[0-9]{8}$'),
  ADD COLUMN sat_unit_key text NOT NULL DEFAULT 'H87' CHECK (sat_unit_key ~ '^[A-Z0-9]{2,3}$'),
  ADD COLUMN sat_unit_name text NOT NULL DEFAULT 'Pieza';

-- Código secreto impreso en el ticket para autofacturación (48 bits aleatorios; único por tenant)
ALTER TABLE orders ADD COLUMN invoice_code text NOT NULL DEFAULT upper(encode(gen_random_bytes(6), 'hex'));
CREATE UNIQUE INDEX orders_invoice_code_uq ON orders (tenant_id, invoice_code);

CREATE TABLE fiscal_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES restaurants(id),
  rfc text NOT NULL CHECK (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  legal_name text NOT NULL,
  regimen_fiscal text NOT NULL CHECK (regimen_fiscal ~ '^[0-9]{3}$'),
  postal_code text NOT NULL CHECK (postal_code ~ '^[0-9]{5}$'),     -- lugar de expedición por defecto
  series text NOT NULL DEFAULT 'A' CHECK (series ~ '^[A-Z0-9]{1,10}$'),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('fiscal_profiles');

CREATE TABLE customer_fiscal_data (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  rfc text NOT NULL, legal_name text NOT NULL, regimen_fiscal text NOT NULL, postal_code text NOT NULL,
  cfdi_use text NOT NULL DEFAULT 'G03', email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('customer_fiscal_data');

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  kind text NOT NULL DEFAULT 'ORDER' CHECK (kind IN ('ORDER','GLOBAL')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','STAMPED','CANCEL_PENDING','CANCELLED','ERROR')),
  series text NOT NULL, folio bigint NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issuer_rfc text NOT NULL, issuer_name text NOT NULL, issuer_regimen text NOT NULL, place_of_issue text NOT NULL,
  receptor_rfc text NOT NULL, receptor_name text NOT NULL, receptor_regimen text NOT NULL, receptor_postal_code text NOT NULL, cfdi_use text NOT NULL,
  forma_pago text NOT NULL, metodo_pago text NOT NULL DEFAULT 'PUE', currency char(3) NOT NULL DEFAULT 'MXN',
  subtotal numeric(14,2) NOT NULL, discount numeric(14,2) NOT NULL DEFAULT 0, tax numeric(14,2) NOT NULL, total numeric(14,2) NOT NULL CHECK (total > 0),
  global_info jsonb,
  draft jsonb NOT NULL,                      -- borrador estructurado enviado al PAC (reproducible)
  uuid_sat text, stamped_at timestamptz, xml text, sat_seal text, provider text NOT NULL, simulated boolean NOT NULL DEFAULT false,
  error_message text,
  cancel_motive text, cancel_replacement_uuid text, cancelled_at timestamptz, cancel_acuse text, cancelled_by uuid REFERENCES users(id),
  customer_id uuid REFERENCES customers(id), receptor_email text,
  created_by uuid REFERENCES users(id), via text NOT NULL DEFAULT 'STAFF' CHECK (via IN ('STAFF','SELF','SYSTEM')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoices_folio_uq ON invoices (tenant_id, series, folio);
CREATE UNIQUE INDEX invoices_uuid_uq ON invoices (uuid_sat) WHERE uuid_sat IS NOT NULL;
CREATE INDEX invoices_branch_idx ON invoices (tenant_id, branch_id, issued_at DESC);
SELECT enable_tenant_rls('invoices'), add_updated_at_trigger('invoices');

-- Un comprobante timbrado es inmutable en lo fiscal: sólo cambian estado/cancelación.
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('STAMPED','CANCEL_PENDING','CANCELLED') AND (
       NEW.uuid_sat IS DISTINCT FROM OLD.uuid_sat OR NEW.xml IS DISTINCT FROM OLD.xml OR NEW.total <> OLD.total OR NEW.subtotal <> OLD.subtotal
       OR NEW.tax <> OLD.tax OR NEW.receptor_rfc <> OLD.receptor_rfc OR NEW.folio <> OLD.folio OR NEW.series <> OLD.series OR NEW.draft IS DISTINCT FROM OLD.draft) THEN
    RAISE EXCEPTION 'Un CFDI timbrado no se puede modificar' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Los CFDI no se eliminan' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_invoices_guard BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_guard();

CREATE TABLE invoice_items (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  position int NOT NULL,
  sat_product_key text NOT NULL, sat_unit_key text NOT NULL, unit_name text NOT NULL, description text NOT NULL,
  qty numeric(14,4) NOT NULL, unit_value numeric(18,6) NOT NULL,
  amount numeric(14,2) NOT NULL, discount numeric(14,2) NOT NULL DEFAULT 0, base numeric(14,2) NOT NULL, tax_rate numeric(8,6) NOT NULL, tax numeric(14,2) NOT NULL
);
CREATE INDEX invoice_items_invoice_idx ON invoice_items (invoice_id);
SELECT enable_tenant_rls('invoice_items'), make_append_only('invoice_items');

-- Relación orden ↔ factura. `active` = la factura vigente que cubre la orden (a lo más una).
CREATE TABLE invoice_orders (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (invoice_id, order_id)
);
CREATE UNIQUE INDEX invoice_orders_active_uq ON invoice_orders (order_id) WHERE active;
SELECT enable_tenant_rls('invoice_orders');
