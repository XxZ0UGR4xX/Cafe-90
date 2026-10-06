-- 004: reservaciones, lealtad, promociones, delivery, impresión, sincronización offline, jobs.

-- Lectura de tenants para jobs en segundo plano (SECURITY DEFINER: current_user ≠ session_user)
CREATE POLICY system_read ON restaurants FOR SELECT USING (current_user <> session_user);
CREATE OR REPLACE FUNCTION list_active_tenants() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM restaurants WHERE status = 'ACTIVE' AND deleted_at IS NULL
$$;

ALTER TABLE orders ADD COLUMN coupon_codes text[] NOT NULL DEFAULT '{}';
ALTER TABLE orders ADD COLUMN source text NOT NULL DEFAULT 'STAFF' CHECK (source IN ('STAFF','PUBLIC','QR','SYNC'));
ALTER TABLE orders ADD COLUMN points_earned int NOT NULL DEFAULT 0;

-- ───────── Reservaciones ─────────
CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid REFERENCES customers(id),
  customer_name text NOT NULL,
  phone text,
  party_size int NOT NULL CHECK (party_size > 0 AND party_size <= 50),
  starts_at timestamptz NOT NULL,
  duration_min int NOT NULL DEFAULT 90 CHECK (duration_min BETWEEN 15 AND 480),
  ends_at timestamptz NOT NULL,
  table_id uuid REFERENCES tables(id),
  notes text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','ARRIVED','CANCELLED','NO_SHOW')),
  source text NOT NULL DEFAULT 'STAFF' CHECK (source IN ('STAFF','PUBLIC')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION reservations_set_end() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.ends_at := NEW.starts_at + NEW.duration_min * interval '1 minute'; RETURN NEW; END $$;
CREATE TRIGGER trg_reservations_end BEFORE INSERT OR UPDATE OF starts_at, duration_min ON reservations FOR EACH ROW EXECUTE FUNCTION reservations_set_end();
-- Una mesa no puede tener dos reservaciones activas empalmadas
ALTER TABLE reservations ADD CONSTRAINT reservations_no_overlap
  EXCLUDE USING gist (table_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (table_id IS NOT NULL AND status IN ('PENDING','CONFIRMED','ARRIVED'));
CREATE INDEX reservations_branch_time_idx ON reservations (tenant_id, branch_id, starts_at);
SELECT enable_tenant_rls('reservations'), add_updated_at_trigger('reservations');

-- ───────── Lealtad ─────────
CREATE TABLE loyalty_programs (
  tenant_id uuid PRIMARY KEY REFERENCES restaurants(id),
  is_active boolean NOT NULL DEFAULT true,
  currency_per_point numeric(14,4) NOT NULL DEFAULT 10 CHECK (currency_per_point > 0),   -- cada $10 = 1 punto
  levels jsonb NOT NULL DEFAULT '[{"name":"BRONCE","min":0},{"name":"PLATA","min":500},{"name":"ORO","min":1500}]',
  expiry_days int,
  updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('loyalty_programs');

CREATE TABLE loyalty_rewards (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  points_cost int NOT NULL CHECK (points_cost > 0),
  product_id uuid REFERENCES products(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('loyalty_rewards');

CREATE TABLE loyalty_accounts (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  customer_id uuid NOT NULL UNIQUE REFERENCES customers(id),
  balance int NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_points int NOT NULL DEFAULT 0,
  level text NOT NULL DEFAULT 'BRONCE',
  updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('loyalty_accounts');

CREATE TABLE loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  account_id uuid NOT NULL REFERENCES loyalty_accounts(id),
  type text NOT NULL CHECK (type IN ('EARN','REDEEM','ADJUST','REVERSAL','EXPIRE')),
  points int NOT NULL CHECK (points <> 0),
  balance_after int NOT NULL,
  order_id uuid REFERENCES orders(id),
  reward_id uuid REFERENCES loyalty_rewards(id),
  reason text,
  user_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_tx_account_idx ON loyalty_transactions (account_id, at DESC);
CREATE UNIQUE INDEX loyalty_tx_earn_once ON loyalty_transactions (order_id, type) WHERE type IN ('EARN','REVERSAL') AND order_id IS NOT NULL;
SELECT enable_tenant_rls('loyalty_transactions'), make_append_only('loyalty_transactions');

-- ───────── Promociones ─────────
CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('BOGO','PERCENT','FIXED','HAPPY_HOUR','FREE_PRODUCT','COUPON','BIRTHDAY','DOUBLE_POINTS')),
  config jsonb NOT NULL DEFAULT '{}',
  code text,
  schedule jsonb,                       -- {"days":[1,2,3,4,5],"from":"17:00","to":"19:00"}
  starts_at timestamptz,
  ends_at timestamptz,
  branch_ids uuid[],                    -- NULL = todas
  priority int NOT NULL DEFAULT 0,
  stackable boolean NOT NULL DEFAULT false,
  max_redemptions int,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX promotions_code_uq ON promotions (tenant_id, upper(code)) WHERE code IS NOT NULL AND deleted_at IS NULL;
SELECT enable_tenant_rls('promotions'), add_updated_at_trigger('promotions');

CREATE TABLE promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id),
  amount numeric(14,4) NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, order_id)
);
SELECT enable_tenant_rls('promotion_redemptions');

-- ───────── Delivery ─────────
CREATE TABLE delivery_orders (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  customer_name text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  address_notes text,
  fee numeric(14,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','CONFIRMED','PREPARING','READY','ON_THE_WAY','DELIVERED','CANCELLED')),
  driver_id uuid REFERENCES users(id),
  payment_method text NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH','CARD','TRANSFER','QR','PAID')),
  eta_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_orders_idx ON delivery_orders (tenant_id, branch_id, status);
CREATE INDEX delivery_orders_driver_idx ON delivery_orders (driver_id) WHERE driver_id IS NOT NULL;
SELECT enable_tenant_rls('delivery_orders'), add_updated_at_trigger('delivery_orders');

CREATE TABLE delivery_status_history (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  delivery_id uuid NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  status text NOT NULL, user_id uuid, at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('delivery_status_history');

-- ───────── Impresión ─────────
CREATE TABLE printers (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('KITCHEN','CASH','BAR')),
  connection jsonb NOT NULL DEFAULT '{}',    -- {"type":"network","host":"192.168.1.50","port":9100} | {"type":"usb"}
  columns int NOT NULL DEFAULT 42,
  station_keys text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (branch_id, name)
);
SELECT enable_tenant_rls('printers');

CREATE TABLE print_jobs (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  printer_id uuid REFERENCES printers(id),
  kind text NOT NULL CHECK (kind IN ('RECEIPT','KITCHEN_TICKET','CASH_CLOSE','PURCHASE_ORDER','INVOICE','REPORT')),
  ref_id uuid,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PRINTED','FAILED')),
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  printed_at timestamptz
);
CREATE INDEX print_jobs_pending_idx ON print_jobs (tenant_id, printer_id, created_at) WHERE status = 'PENDING';
SELECT enable_tenant_rls('print_jobs');

-- ───────── Sincronización offline ─────────
CREATE TABLE sync_operations (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid REFERENCES branches(id),
  device_id text NOT NULL,
  op_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('APPLIED','DUPLICATE','FAILED','NEEDS_REVIEW','RESOLVED')),
  result jsonb,
  error text,
  client_created_at timestamptz,
  user_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, op_id)
);
CREATE INDEX sync_operations_status_idx ON sync_operations (tenant_id, status, received_at DESC);
SELECT enable_tenant_rls('sync_operations');

-- Usuario de sistema para pedidos públicos / QR (no puede iniciar sesión)
ALTER TABLE users ADD COLUMN is_system boolean NOT NULL DEFAULT false;
