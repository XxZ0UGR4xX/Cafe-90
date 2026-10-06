-- 003: clientes, mesas, ventas, pagos, cocina, caja, notificaciones.

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  phone text,
  email text,
  birthday date,
  marketing_consent boolean NOT NULL DEFAULT false,
  total_spent numeric(14,4) NOT NULL DEFAULT 0,
  visits int NOT NULL DEFAULT 0,
  last_visit_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX customers_phone_uq ON customers (tenant_id, phone) WHERE deleted_at IS NULL AND phone IS NOT NULL;
CREATE UNIQUE INDEX customers_email_uq ON customers (tenant_id, lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX customers_name_trgm ON customers USING gin (name gin_trgm_ops);
SELECT enable_tenant_rls('customers'), add_updated_at_trigger('customers');

CREATE TABLE customer_addresses (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label text, line1 text NOT NULL, references_text text, is_default boolean NOT NULL DEFAULT false
);
SELECT enable_tenant_rls('customer_addresses');

CREATE TABLE tables (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  number int NOT NULL CHECK (number > 0),
  capacity int NOT NULL DEFAULT 4 CHECK (capacity > 0),
  shape text NOT NULL DEFAULT 'SQUARE' CHECK (shape IN ('SQUARE','ROUND','BOOTH','BAR')),
  x int NOT NULL DEFAULT 0, y int NOT NULL DEFAULT 0, w int NOT NULL DEFAULT 1, h int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'FREE' CHECK (status IN ('FREE','OCCUPIED','RESERVED','CLEANING')),
  qr_token text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex') UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, number)
);
SELECT enable_tenant_rls('tables');

CREATE TABLE table_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  table_id uuid NOT NULL REFERENCES tables(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  guests int NOT NULL DEFAULT 1 CHECK (guests > 0),
  waiter_id uuid REFERENCES users(id),
  customer_id uuid REFERENCES customers(id),
  customer_name text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX table_sessions_one_open ON table_sessions (table_id) WHERE status = 'OPEN';
CREATE INDEX table_sessions_branch_idx ON table_sessions (tenant_id, branch_id, status);
SELECT enable_tenant_rls('table_sessions');

CREATE TABLE table_session_tables (   -- mesas unidas a una sesión
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  session_id uuid NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES tables(id),
  PRIMARY KEY (session_id, table_id)
);
SELECT enable_tenant_rls('table_session_tables');

-- ───────── Cajas y turnos (antes que pagos) ─────────
CREATE TABLE cash_registers (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (branch_id, name)
);
SELECT enable_tenant_rls('cash_registers');

CREATE TABLE cash_shifts (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  register_id uuid NOT NULL REFERENCES cash_registers(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_float numeric(14,4) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  closed_at timestamptz,
  expected_cash numeric(14,4),
  counted_cash numeric(14,4),
  difference numeric(14,4),
  close_notes text,
  closed_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  report jsonb
);
CREATE UNIQUE INDEX cash_shifts_one_open_per_user ON cash_shifts (user_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX cash_shifts_one_open_per_register ON cash_shifts (register_id) WHERE status = 'OPEN';
CREATE INDEX cash_shifts_branch_idx ON cash_shifts (tenant_id, branch_id, opened_at DESC);
SELECT enable_tenant_rls('cash_shifts');

-- ───────── Ventas ─────────
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  number bigint NOT NULL,
  business_date date NOT NULL,
  channel text NOT NULL DEFAULT 'DINE_IN' CHECK (channel IN ('DINE_IN','TAKEAWAY','DELIVERY','QR')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING','CONFIRMED','PREPARING','READY','DELIVERED','COMPLETED','CANCELLED')),
  payment_status text NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING','PAID','PARTIAL','REFUNDED','FAILED')),
  table_session_id uuid REFERENCES table_sessions(id),
  table_id uuid REFERENCES tables(id),
  customer_id uuid REFERENCES customers(id),
  customer_name text,
  waiter_id uuid REFERENCES users(id),
  guests int,
  subtotal numeric(14,4) NOT NULL DEFAULT 0,
  discount_total numeric(14,4) NOT NULL DEFAULT 0,
  tax_total numeric(14,4) NOT NULL DEFAULT 0,
  tip_total numeric(14,4) NOT NULL DEFAULT 0,
  total numeric(14,4) NOT NULL DEFAULT 0,
  paid_total numeric(14,4) NOT NULL DEFAULT 0,
  cost_total numeric(14,4) NOT NULL DEFAULT 0,
  notes text,
  client_uuid uuid,
  needs_review boolean NOT NULL DEFAULT false,
  cancel_reason text, cancelled_by uuid, cancelled_at timestamptz,
  sent_at timestamptz, closed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX orders_number_uq ON orders (tenant_id, branch_id, business_date, number);
CREATE UNIQUE INDEX orders_client_uuid_uq ON orders (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL;
CREATE INDEX orders_branch_status_idx ON orders (tenant_id, branch_id, status, created_at DESC);
CREATE INDEX orders_branch_date_idx ON orders (tenant_id, branch_id, business_date);
CREATE INDEX orders_session_idx ON orders (table_session_id);
CREATE INDEX orders_customer_idx ON orders (customer_id) WHERE customer_id IS NOT NULL;
SELECT enable_tenant_rls('orders'), add_updated_at_trigger('orders');

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  parent_item_id uuid REFERENCES order_items(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  variant_id uuid REFERENCES product_variants(id),
  slot_name text,
  name text NOT NULL,                       -- snapshot
  qty int NOT NULL CHECK (qty > 0),
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),   -- snapshot (incluye variante y modificadores)
  tax_rate numeric(6,4) NOT NULL DEFAULT 0,
  tax_included boolean NOT NULL DEFAULT true,
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,                  -- snapshot de costo de receta
  line_total numeric(14,4) NOT NULL,
  line_tax numeric(14,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','PREPARING','READY','DELIVERED','CANCELLED')),
  station_key text,
  notes text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_product_idx ON order_items (tenant_id, product_id);
SELECT enable_tenant_rls('order_items');

CREATE TABLE order_item_modifiers (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_id uuid REFERENCES modifiers(id) ON DELETE SET NULL,
  name text NOT NULL, group_name text, type text NOT NULL,
  price_delta numeric(14,4) NOT NULL DEFAULT 0,
  ingredient_id uuid REFERENCES ingredients(id),
  qty_delta numeric(14,4) NOT NULL DEFAULT 0
);
CREATE INDEX order_item_modifiers_item_idx ON order_item_modifiers (order_item_id);
SELECT enable_tenant_rls('order_item_modifiers');

CREATE TABLE order_discounts (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  promotion_id uuid,
  kind text NOT NULL CHECK (kind IN ('PERCENT','FIXED','PROMO','POINTS')),
  value numeric(14,4) NOT NULL,
  amount numeric(14,4) NOT NULL CHECK (amount >= 0),
  reason text,
  authorized_by uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_discounts_order_idx ON order_discounts (order_id);
SELECT enable_tenant_rls('order_discounts');

CREATE TABLE order_events (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status text, to_status text NOT NULL, user_id uuid, note text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id);
SELECT enable_tenant_rls('order_events');

CREATE TABLE payments (   -- append-only
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  kind text NOT NULL DEFAULT 'PAYMENT' CHECK (kind IN ('PAYMENT','REFUND')),
  method text NOT NULL CHECK (method IN ('CASH','CARD','TRANSFER','QR')),
  amount numeric(14,4) NOT NULL CHECK (amount <> 0),   -- negativo en reembolsos
  tip numeric(14,4) NOT NULL DEFAULT 0,
  tendered numeric(14,4),                              -- efectivo recibido (para cambio)
  reference text,
  status text NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID','FAILED')),
  cash_shift_id uuid REFERENCES cash_shifts(id),
  client_uuid uuid,
  received_by uuid REFERENCES users(id),
  reason text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_client_uuid_uq ON payments (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL;
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX payments_shift_idx ON payments (cash_shift_id);
CREATE INDEX payments_branch_at_idx ON payments (tenant_id, branch_id, at);
SELECT enable_tenant_rls('payments'), make_append_only('payments');

CREATE TABLE cash_movements (  -- append-only
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  shift_id uuid NOT NULL REFERENCES cash_shifts(id),
  type text NOT NULL CHECK (type IN ('OPENING','SALE','TIP','REFUND','EXPENSE','WITHDRAWAL','DEPOSIT')),
  method text NOT NULL DEFAULT 'CASH' CHECK (method IN ('CASH','CARD','TRANSFER','QR')),
  amount numeric(14,4) NOT NULL,      -- + entra, − sale (respecto a la caja/método)
  order_id uuid REFERENCES orders(id),
  payment_id uuid REFERENCES payments(id),
  reason text,
  authorized_by uuid REFERENCES users(id),
  user_id uuid REFERENCES users(id),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_movements_shift_idx ON cash_movements (shift_id, at);
SELECT enable_tenant_rls('cash_movements'), make_append_only('cash_movements');

-- ───────── Cocina (KDS) ─────────
CREATE TABLE kitchen_orders (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  station_id uuid REFERENCES kitchen_stations(id),
  station_key text NOT NULL,
  round int NOT NULL DEFAULT 1,           -- "rondas" de envío de una misma orden
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','PREPARING','READY','DELIVERED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz, ready_at timestamptz, delivered_at timestamptz,
  bumped_by uuid REFERENCES users(id)
);
CREATE INDEX kitchen_orders_active_idx ON kitchen_orders (tenant_id, branch_id, station_key, status, created_at) WHERE status IN ('NEW','PREPARING','READY');
CREATE INDEX kitchen_orders_order_idx ON kitchen_orders (order_id);
SELECT enable_tenant_rls('kitchen_orders');

CREATE TABLE kitchen_order_items (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  kitchen_order_id uuid NOT NULL REFERENCES kitchen_orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  name text NOT NULL, qty int NOT NULL,
  modifiers text[] NOT NULL DEFAULT '{}',
  notes text
);
CREATE INDEX kitchen_order_items_ko_idx ON kitchen_order_items (kitchen_order_id);
SELECT enable_tenant_rls('kitchen_order_items');

-- ───────── Notificaciones ─────────
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid REFERENCES branches(id),
  type text NOT NULL,                 -- STOCK_LOW, STOCK_OUT, PO_RECEIVED, SHIFT_PENDING, ORDER_DELAYED, RESERVATION_SOON...
  severity text NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  title text NOT NULL,
  body text,
  payload jsonb,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_idx ON notifications (tenant_id, branch_id, created_at DESC);
CREATE UNIQUE INDEX notifications_dedupe_uq ON notifications (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
SELECT enable_tenant_rls('notifications');

CREATE TABLE notification_reads (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);
SELECT enable_tenant_rls('notification_reads');
