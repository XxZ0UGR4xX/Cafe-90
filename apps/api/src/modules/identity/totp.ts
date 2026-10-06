import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP (RFC 6238, HMAC-SHA1, 6 dígitos, paso 30 s) sin dependencias externas. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // tolera ±1 paso (reloj desfasado)

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('base32 inválido');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateSecret = (): string => base32Encode(randomBytes(20));

function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const stepAt = (ms: number): number => Math.floor(ms / 1000 / TOTP_STEP_SECONDS);
export const totpAt = (secretB32: string, ms = Date.now()): string => hotp(base32Decode(secretB32), stepAt(ms));

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Verifica un código. Devuelve el paso coincidente (para impedir reuso: sólo se acepta un paso mayor al último usado)
 * o null si es inválido/reutilizado.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, ms = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = stepAt(ms);
  let hit: number | null = null;
  for (let s = now - WINDOW; s <= now + WINDOW; s++) {
    if (safeEq(hotp(secret, s), code) && (lastStep == null || s > lastStep)) hit = hit == null ? s : Math.max(hit, s);
  }
  return hit;
}

export const otpauthUri = (secretB32: string, account: string, issuer: string): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_STEP_SECONDS}`;

// ── Cifrado del secreto en reposo (AES-256-GCM) ─────────────────────────────
const keyOf = (material: string) => createHash('sha256').update(`retroburger:mfa:${material}`).digest();

export function encryptSecret(plain: string, material: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(material), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(enc: string, material: string): string {
  const [v, iv, tag, ct] = enc.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('secreto MFA con formato inválido');
  const d = createDecipheriv('aes-256-gcm', keyOf(material), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

// ── Códigos de recuperación ─────────────────────────────────────────────────
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const chars = Array.from(b, (x) => RECOVERY_ALPHABET[x % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}
export const normalizeRecovery = (c: string): string => c.replace(/[\s-]/g, '').toUpperCase();
export const hashRecovery = (c: string): string => createHash('sha256').update(`rb-recovery:${normalizeRecovery(c)}`).digest('hex');
export const looksLikeRecovery = (c: string): boolean => /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(c.trim()) && !/^\d{6}$/.test(c.trim());
