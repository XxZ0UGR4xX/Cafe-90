-- 2FA TOTP: secreto activo (cifrado, ya existía mfa_secret_enc), secreto pendiente de confirmar,
-- último paso usado (anti-replay) y códigos de recuperación (sólo hashes, de un solo uso).
ALTER TABLE users
  ADD COLUMN mfa_enabled_at timestamptz,
  ADD COLUMN mfa_pending_secret_enc text,
  ADD COLUMN mfa_last_step bigint,
  ADD COLUMN mfa_recovery_hashes text[] NOT NULL DEFAULT '{}';
