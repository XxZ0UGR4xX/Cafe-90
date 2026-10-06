-- 002: catálogo, recetas, inventario por sucursal, kardex, transferencias, compras.

CREATE TABLE taxes (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  rate numeric(6,4) NOT NULL CHECK (rate >= 0 AND rate <= 1),
  included_in_price boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('taxes');

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  icon text,
  color text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX categories_name_uq ON categories (tenant_id, lower(name)) WHERE deleted_at IS NULL;
SELECT enable_tenant_rls('categories'), add_updated_at_trigger('categories');

CREATE TABLE kitchen_stations (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  key text NOT NULL,                      -- PARRILLA, FREIDORA, BEBIDAS, POSTRES, PREPARACION...
  name text NOT NULL,
  color text,
  printer_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (branch_id, key)
);
SELECT enable_tenant_rls('kitchen_stations');

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  category_id uuid REFERENCES categories(id),
  kind text NOT NULL DEFAULT 'SIMPLE' CHECK (kind IN ('SIMPLE','COMBO')),
  sku text NOT NULL,
  barcode text,
  name text NOT NULL,
  description text,
  image_url text,
  price numeric(14,4) NOT NULL CHECK (price >= 0),
  tax_id uuid REFERENCES taxes(id),
  is_available boolean NOT NULL DEFAULT true,
  is_inventoriable boolean NOT NULL DEFAULT true,
  prep_time_sec int NOT NULL DEFAULT 300 CHECK (prep_time_sec >= 0),
  station_key text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX products_sku_uq ON products (tenant_id, lower(sku)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX products_barcode_uq ON products (tenant_id, barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL;
CREATE INDEX products_category_idx ON products (tenant_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);
SELECT enable_tenant_rls('products'), add_updated_at_trigger('products');

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  price_delta numeric(14,4) NOT NULL DEFAULT 0,
  qty_factor numeric(8,4) NOT NULL DEFAULT 1 CHECK (qty_factor > 0),  -- multiplica la receta (ej. doble = 2)
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX product_variants_product_idx ON product_variants (product_id);
SELECT enable_tenant_rls('product_variants');

CREATE TABLE branch_products (       -- override de precio / disponibilidad por sucursal
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price numeric(14,4) CHECK (price IS NULL OR price >= 0),
  is_available boolean,
  PRIMARY KEY (branch_id, product_id)
);
SELECT enable_tenant_rls('branch_products');

CREATE TABLE ingredients (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  sku text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('g','kg','ml','l','pza')),
  perishable boolean NOT NULL DEFAULT false,
  avg_cost numeric(14,4) NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),   -- costo por unidad
  default_min numeric(14,4) NOT NULL DEFAULT 0,
  default_max numeric(14,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX ingredients_sku_uq ON ingredients (tenant_id, lower(sku)) WHERE deleted_at IS NULL;
SELECT enable_tenant_rls('ingredients'), add_updated_at_trigger('ingredients');

CREATE TABLE recipes (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX recipes_active_uq ON recipes (product_id) WHERE active;
SELECT enable_tenant_rls('recipes');

CREATE TABLE recipe_items (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  qty numeric(14,4) NOT NULL CHECK (qty > 0),
  waste_pct numeric(6,4) NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct < 1),
  UNIQUE (recipe_id, ingredient_id)
);
SELECT enable_tenant_rls('recipe_items');

CREATE TABLE modifier_groups (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('EXTRA','REMOVE','CHOICE')),
  min_select int NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select int NOT NULL DEFAULT 99 CHECK (max_select >= min_select),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
SELECT enable_tenant_rls('modifier_groups');

CREATE TABLE modifiers (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_delta numeric(14,4) NOT NULL DEFAULT 0,
  ingredient_id uuid REFERENCES ingredients(id),
  qty_delta numeric(14,4) NOT NULL DEFAULT 0,   -- + consume extra / − deja de consumir (REMOVE)
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX modifiers_group_idx ON modifiers (group_id);
SELECT enable_tenant_rls('modifiers');

CREATE TABLE product_modifier_groups (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, group_id)
);
SELECT enable_tenant_rls('product_modifier_groups');

-- Combos: cada slot tiene un producto por defecto y sustitutos permitidos.
CREATE TABLE combo_slots (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  combo_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  default_product_id uuid NOT NULL REFERENCES products(id),
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX combo_slots_combo_idx ON combo_slots (combo_id);
SELECT enable_tenant_rls('combo_slots');

CREATE TABLE combo_slot_options (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  slot_id uuid NOT NULL REFERENCES combo_slots(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  price_delta numeric(14,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (slot_id, product_id)
);
SELECT enable_tenant_rls('combo_slot_options');

-- ───────────── Inventario por sucursal ─────────────
CREATE TABLE inventory (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  qty numeric(14,4) NOT NULL DEFAULT 0,        -- puede ser negativo (venta offline sin stock → revisión)
  min_qty numeric(14,4) NOT NULL DEFAULT 0,
  max_qty numeric(14,4) NOT NULL DEFAULT 0,
  needs_review boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, ingredient_id)
);
CREATE INDEX inventory_tenant_idx ON inventory (tenant_id, ingredient_id);
SELECT enable_tenant_rls('inventory');

CREATE TABLE inventory_lots (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  lot_code text,
  expires_on date,
  qty_remaining numeric(14,4) NOT NULL CHECK (qty_remaining >= 0),
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_lots_fefo_idx ON inventory_lots (branch_id, ingredient_id, expires_on NULLS LAST, received_at) WHERE qty_remaining > 0;
SELECT enable_tenant_rls('inventory_lots');

CREATE TABLE inventory_movements (    -- kardex (append-only)
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  type text NOT NULL CHECK (type IN ('PURCHASE_IN','SALE_OUT','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT','WASTE','COUNT_ADJ','RETURN','SALE_REVERSAL')),
  qty numeric(14,4) NOT NULL CHECK (qty <> 0),
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  balance_after numeric(14,4) NOT NULL,
  lot_id uuid REFERENCES inventory_lots(id),
  ref_type text,
  ref_id uuid,
  reason text,
  user_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_kardex_idx ON inventory_movements (tenant_id, branch_id, ingredient_id, at DESC);
CREATE INDEX inventory_movements_ref_idx ON inventory_movements (ref_type, ref_id);
SELECT enable_tenant_rls('inventory_movements'), make_append_only('inventory_movements');

CREATE TABLE stock_transfers (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  number bigint NOT NULL,
  from_branch_id uuid NOT NULL REFERENCES branches(id),
  to_branch_id uuid NOT NULL REFERENCES branches(id),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','CANCELLED')),
  notes text,
  requested_by uuid, approved_by uuid, dispatched_at timestamptz, received_by uuid, received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_branch_id <> to_branch_id)
);
SELECT enable_tenant_rls('stock_transfers'), add_updated_at_trigger('stock_transfers');

CREATE TABLE stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  qty_requested numeric(14,4) NOT NULL CHECK (qty_requested > 0),
  qty_sent numeric(14,4),
  qty_received numeric(14,4),
  unit_cost numeric(14,4)
);
SELECT enable_tenant_rls('stock_transfer_items');

CREATE TABLE stock_counts (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPLIED','CANCELLED')),
  notes text,
  created_by uuid, applied_by uuid, applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('stock_counts');

CREATE TABLE stock_count_items (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  system_qty numeric(14,4) NOT NULL,
  counted_qty numeric(14,4),
  PRIMARY KEY (count_id, ingredient_id)
);
SELECT enable_tenant_rls('stock_count_items');

-- ───────────── Compras ─────────────
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  contact_name text, phone text, email text, tax_id text, address text,
  lead_time_days int NOT NULL DEFAULT 2,
  payment_terms_days int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX suppliers_name_uq ON suppliers (tenant_id, lower(name)) WHERE deleted_at IS NULL;
SELECT enable_tenant_rls('suppliers'), add_updated_at_trigger('suppliers');

CREATE TABLE supplier_products (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  price numeric(14,4) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (supplier_id, ingredient_id)
);
SELECT enable_tenant_rls('supplier_products');

CREATE TABLE purchase_quotes (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACCEPTED','REJECTED')),
  valid_until date, notes text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('purchase_quotes');
CREATE TABLE purchase_quote_items (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  quote_id uuid NOT NULL REFERENCES purchase_quotes(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  qty numeric(14,4) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (quote_id, ingredient_id)
);
SELECT enable_tenant_rls('purchase_quote_items');

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  quote_id uuid REFERENCES purchase_quotes(id),
  number bigint NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','SENT','PARTIAL','RECEIVED','CANCELLED')),
  subtotal numeric(14,4) NOT NULL DEFAULT 0,
  tax_total numeric(14,4) NOT NULL DEFAULT 0,
  total numeric(14,4) NOT NULL DEFAULT 0,
  expected_on date,
  notes text,
  created_by uuid, approved_by uuid, sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX purchase_orders_number_uq ON purchase_orders (tenant_id, branch_id, number);
SELECT enable_tenant_rls('purchase_orders'), add_updated_at_trigger('purchase_orders');

CREATE TABLE purchase_order_items (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  qty numeric(14,4) NOT NULL CHECK (qty > 0),
  qty_received numeric(14,4) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  UNIQUE (purchase_order_id, ingredient_id)
);
SELECT enable_tenant_rls('purchase_order_items');

CREATE TABLE goods_receipts (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
  notes text, received_by uuid,
  received_at timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('goods_receipts');
CREATE TABLE goods_receipt_items (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  receipt_id uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  qty numeric(14,4) NOT NULL CHECK (qty > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  lot_code text,
  expires_on date
);
SELECT enable_tenant_rls('goods_receipt_items');

CREATE TABLE supplier_invoices (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  purchase_order_id uuid REFERENCES purchase_orders(id),
  invoice_number text NOT NULL,
  total numeric(14,4) NOT NULL CHECK (total >= 0),
  issued_on date NOT NULL DEFAULT current_date,
  due_on date,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','DISPUTED')),
  price_variance_flag boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, supplier_id, invoice_number)
);
SELECT enable_tenant_rls('supplier_invoices');

CREATE TABLE ingredient_cost_history (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id),
  supplier_id uuid REFERENCES suppliers(id),
  unit_cost numeric(14,4) NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingredient_cost_history_idx ON ingredient_cost_history (tenant_id, ingredient_id, at DESC);
SELECT enable_tenant_rls('ingredient_cost_history'), make_append_only('ingredient_cost_history');
