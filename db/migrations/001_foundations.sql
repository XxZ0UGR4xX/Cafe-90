-- 001_foundations: extensiones, utilidades, tenancy, identidad, auditoría, outbox.
-- Todas las tablas de negocio llevan tenant_id y RLS FORZADA.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- UUID v7 (ordenable por tiempo)
CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch FROM clock_timestamp())*1000)::bigint) FROM 3) FROM 1 FOR 6),
      52, 1), 53, 1), 'hex')::uuid
$$;

CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'La tabla % es de solo-inserción (append-only)', TG_TABLE_NAME USING ERRCODE = '55000'; END $$;

-- Activa RLS por tenant (falla cerrada si no hay contexto).
CREATE OR REPLACE FUNCTION enable_tenant_rls(tbl regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', tbl);
END $$;

CREATE OR REPLACE FUNCTION add_updated_at_trigger(tbl regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at ON %s', tbl);
  EXECUTE format('CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()', tbl);
END $$;

CREATE OR REPLACE FUNCTION make_append_only(tbl regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS trg_append_only ON %s', tbl);
  EXECUTE format('CREATE TRIGGER trg_append_only BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', tbl);
END $$;

-- ───────────── Tenants ─────────────
CREATE TABLE restaurants (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name text NOT NULL,
  legal_name text,
  tax_id text,
  plan text NOT NULL DEFAULT 'standard',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  currency char(3) NOT NULL DEFAULT 'MXN',
  locale text NOT NULL DEFAULT 'es-MX',
  timezone text NOT NULL DEFAULT 'America/Mexico_City',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
SELECT add_updated_at_trigger('restaurants');
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON restaurants USING (id = app_tenant_id()) WITH CHECK (id = app_tenant_id());

-- Resolución de tenant por slug para login (única superficie pre-tenant).
-- Política de sólo lectura que expone ÚNICAMENTE la fila cuyo slug se fija en la transacción.
CREATE POLICY slug_lookup ON restaurants FOR SELECT USING (slug = current_setting('app.lookup_slug', true));
CREATE OR REPLACE FUNCTION resolve_tenant(p_slug text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r uuid;
BEGIN
  PERFORM set_config('app.lookup_slug', p_slug, true);
  SELECT id INTO r FROM restaurants WHERE slug = p_slug AND status = 'ACTIVE' AND deleted_at IS NULL;
  PERFORM set_config('app.lookup_slug', '', true);
  RETURN r;
END $$;

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  code text NOT NULL,
  address text,
  phone text,
  geo point,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','MAINTENANCE')),
  timezone text NOT NULL DEFAULT 'America/Mexico_City',
  opening_hours jsonb NOT NULL DEFAULT '{}',
  business_day_cutoff time NOT NULL DEFAULT '04:00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX branches_code_uq ON branches (tenant_id, code) WHERE deleted_at IS NULL;
CREATE INDEX branches_tenant_idx ON branches (tenant_id);
SELECT enable_tenant_rls('branches'), add_updated_at_trigger('branches');

-- ───────────── Identidad ─────────────
CREATE TABLE permissions (  -- catálogo global (sin tenant)
  key text PRIMARY KEY,
  module text NOT NULL
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  key text NOT NULL CHECK (key ~ '^[A-Z0-9_]+$'),
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);
SELECT enable_tenant_rls('roles'), add_updated_at_trigger('roles');

CREATE TABLE role_permissions (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX role_permissions_tenant_idx ON role_permissions (tenant_id);
SELECT enable_tenant_rls('role_permissions');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  email text NOT NULL,
  user_code text,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  pin_hash text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  mfa_secret_enc text,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (tenant_id, lower(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_code_uq ON users (tenant_id, user_code) WHERE deleted_at IS NULL AND user_code IS NOT NULL;
SELECT enable_tenant_rls('users'), add_updated_at_trigger('users');

-- branch_id NULL = alcance a TODAS las sucursales
CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX user_roles_uq ON user_roles (user_id, role_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'));
CREATE INDEX user_roles_tenant_user_idx ON user_roles (tenant_id, user_id);
SELECT enable_tenant_rls('user_roles');

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (tenant_id, user_id);
SELECT enable_tenant_rls('refresh_tokens');

-- Búsqueda de refresh token pre-tenant: el hash (alta entropía) actúa como secreto de acceso a su fila.
CREATE POLICY refresh_lookup ON refresh_tokens FOR SELECT USING (token_hash = current_setting('app.lookup_refresh', true));
CREATE OR REPLACE FUNCTION resolve_refresh_tenant(p_hash text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r uuid;
BEGIN
  PERFORM set_config('app.lookup_refresh', p_hash, true);
  SELECT tenant_id INTO r FROM refresh_tokens WHERE token_hash = p_hash;
  PERFORM set_config('app.lookup_refresh', '', true);
  RETURN r;
END $$;

-- Empleados (RRHH) — salario en columna restringida por permiso a nivel de servicio.
CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid REFERENCES branches(id),
  user_id uuid REFERENCES users(id),
  full_name text NOT NULL,
  phone text,
  email text,
  position text NOT NULL,
  salary numeric(14,4) CHECK (salary IS NULL OR salary >= 0),
  hired_at date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX employees_tenant_branch_idx ON employees (tenant_id, branch_id);
SELECT enable_tenant_rls('employees'), add_updated_at_trigger('employees');

-- ───────────── Configuración ─────────────
CREATE TABLE settings (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  version int NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX settings_uq ON settings (tenant_id, key, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'));
SELECT enable_tenant_rls('settings');

-- ───────────── Auditoría (append-only, particionada por mes) ─────────────
CREATE TABLE audit_logs (
  id uuid NOT NULL DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid,
  user_id uuid,
  user_name text,
  ip inet,
  user_agent text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  request_id text,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
CREATE INDEX audit_logs_tenant_at_idx ON audit_logs (tenant_id, at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (tenant_id, entity, entity_id);
CREATE INDEX audit_logs_user_idx ON audit_logs (tenant_id, user_id, at DESC);
SELECT enable_tenant_rls('audit_logs'), make_append_only('audit_logs');
SELECT enable_tenant_rls('audit_logs_default');

-- ───────────── Infraestructura de eventos / idempotencia / folios ─────────────
CREATE TABLE domain_outbox (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  branch_id uuid,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX domain_outbox_pending_idx ON domain_outbox (created_at) WHERE published_at IS NULL;
SELECT enable_tenant_rls('domain_outbox');

CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  key text NOT NULL,
  scope text NOT NULL,
  request_hash text NOT NULL,
  response jsonb,
  status_code int,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, key)
);
SELECT enable_tenant_rls('idempotency_keys');

CREATE TABLE counters (
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  scope text NOT NULL,        -- p.ej. 'order:<branch>:<yyyymmdd>'
  value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, scope)
);
SELECT enable_tenant_rls('counters');

CREATE OR REPLACE FUNCTION next_counter(p_scope text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO counters (tenant_id, scope, value) VALUES (app_tenant_id(), p_scope, 1)
  ON CONFLICT (tenant_id, scope) DO UPDATE SET value = counters.value + 1
  RETURNING value
$$;
