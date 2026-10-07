-- 009: cola de correo saliente (durable, con reintentos; nunca se envía dentro de una transacción de negocio)
CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES restaurants(id),
  to_addrs text[] NOT NULL CHECK (cardinality(to_addrs) BETWEEN 1 AND 20),
  subject text NOT NULL,
  body_text text NOT NULL,
  body_html text,
  attachments jsonb NOT NULL DEFAULT '[]',            -- [{filename, contentType, content}] (texto)
  kind text NOT NULL DEFAULT 'GENERIC',
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  last_error text,
  sent_at timestamptz,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_outbox_dedupe_uq ON email_outbox (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX email_outbox_pending_idx ON email_outbox (tenant_id, next_attempt_at) WHERE status IN ('PENDING','SENDING');
SELECT enable_tenant_rls('email_outbox');
