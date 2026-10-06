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
