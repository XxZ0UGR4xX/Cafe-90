import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export interface AccessClaims { sub: string; tid: string; sid: string }

const enc = (s: string) => new TextEncoder().encode(s);

export async function signAccess(c: AccessClaims, secret: string, ttlSeconds: number): Promise<string> {
  return new SignJWT({ tid: c.tid, sid: c.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setIssuer('retroburger')
    .sign(enc(secret));
}

export async function verifyAccess(token: string, secret: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, enc(secret), { issuer: 'retroburger', algorithms: ['HS256'] });
  return { sub: String(payload.sub), tid: String(payload.tid), sid: String(payload.sid) };
}

export const newOpaqueToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

/**
 * Token efímero del paso intermedio de 2FA. Emisor y clave distintos a los del access token:
 * no sirve como Bearer (verifyAccess lo rechaza por emisor) y sólo vale para los endpoints /auth/2fa/*.
 */
export type MfaPurpose = 'challenge' | 'enroll';
const MFA_ISSUER = 'retroburger-mfa';
const mfaKey = (secret: string) => enc(`${secret}:mfa-step`);

export async function signMfa(c: { sub: string; tid: string; purpose: MfaPurpose }, secret: string, ttlSeconds = 300): Promise<string> {
  return new SignJWT({ tid: c.tid, purpose: c.purpose })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(c.sub).setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`).setIssuer(MFA_ISSUER).sign(mfaKey(secret));
}

export async function verifyMfa(token: string, secret: string, purpose: MfaPurpose): Promise<{ sub: string; tid: string }> {
  const { payload } = await jwtVerify(token, mfaKey(secret), { issuer: MFA_ISSUER, algorithms: ['HS256'] });
  if (payload.purpose !== purpose) throw new Error('propósito de token inválido');
  return { sub: String(payload.sub), tid: String(payload.tid) };
}
