import { hash, verify } from '@node-rs/argon2';

/** Argon2id con parámetros OWASP (m=19MiB, t=2, p=1). Nunca se guarda texto plano. */
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 as const };

export const hashSecret = (plain: string): Promise<string> => hash(plain, OPTS);
export async function verifySecret(hashed: string, plain: string): Promise<boolean> {
  try { return await verify(hashed, plain); } catch { return false; }
}
