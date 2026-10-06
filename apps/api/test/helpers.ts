import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/bootstrap';
import { ProvisionerService } from '../src/modules/tenancy/provisioner.service';

export const PASSWORD = 'Sup3r-Secret-Pass!';

export interface Api {
  app: NestFastifyApplication;
  req(method: string, url: string, opts?: { token?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: any; headers: any; raw: any }>;
}

export async function startApi(): Promise<Api> {
  const app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    async req(method, url, opts = {}) {
      const res = await app.inject({
        method: method as any, url,
        headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
        payload: opts.body as any,
      });
      let body: any; try { body = res.json(); } catch { body = res.body; }
      return { status: res.statusCode, body, headers: res.headers, raw: res };
    },
  };
}

export interface TenantFixture { tenantId: string; slug: string; adminEmail: string; adminId: string }

export async function newTenant(api: Api, label = 't'): Promise<TenantFixture> {
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const adminEmail = `admin@${slug}.test`;
  const prov = api.app.get(ProvisionerService);
  const { tenantId, adminId } = await prov.createTenant({
    slug, name: `Tenant ${slug}`, admin: { email: adminEmail, fullName: 'Admin', password: PASSWORD },
  });
  return { tenantId, slug, adminEmail, adminId };
}

export async function login(api: Api, t: { slug: string }, email: string, password = PASSWORD): Promise<string> {
  const r = await api.req('POST', '/auth/login', { body: { tenant: t.slug, email, password } });
  if (r.status !== 200) throw new Error(`login falló ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.accessToken;
}

/** Crea un usuario con un rol (y sucursales) usando el token del admin. */
export async function createUser(api: Api, adminToken: string, t: { slug: string }, role: string,
  branchIds: string[] | null, tag = role.toLowerCase()) {
  const email = `${tag}-${randomUUID().slice(0, 6)}@${t.slug}.test`;
  const r = await api.req('POST', '/users', { token: adminToken, body: {
    email, fullName: `User ${tag}`, password: PASSWORD, pin: '1234', userCode: `${tag}-${randomUUID().slice(0, 4)}`,
    roles: [{ role, branchIds }] } });
  if (r.status !== 201) throw new Error(`createUser ${r.status} ${JSON.stringify(r.body)}`);
  return { email, id: r.body.id as string, userCode: r.body.user_code as string };
}

export async function createBranch(api: Api, token: string, code: string, name = `Sucursal ${code}`) {
  const r = await api.req('POST', '/branches', { token, body: { name, code } });
  if (r.status !== 201) throw new Error(`createBranch ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { id: string };
}
