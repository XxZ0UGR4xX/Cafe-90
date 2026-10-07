/**
 * Alta de un restaurante (tenant) en un entorno REAL, sin datos de demostración.
 *   PROVISION_SLUG=mi-restaurante PROVISION_NAME="Mi Restaurante" PROVISION_ADMIN_EMAIL=dueno@dominio.com \
 *   PROVISION_ADMIN_PASSWORD='…(≥12 caracteres)…' node dist/database/provision.js
 * La contraseña se lee del entorno (no de argumentos, que quedan en el historial del shell). Cámbiala al primer ingreso.
 */
import 'reflect-metadata';
import { createApp } from '../bootstrap';
import { ProvisionerService } from '../modules/tenancy/provisioner.service';

async function main() {
  const slug = process.env.PROVISION_SLUG, name = process.env.PROVISION_NAME, email = process.env.PROVISION_ADMIN_EMAIL, password = process.env.PROVISION_ADMIN_PASSWORD;
  if (!slug || !name || !email || !password) throw new Error('Faltan PROVISION_SLUG, PROVISION_NAME, PROVISION_ADMIN_EMAIL o PROVISION_ADMIN_PASSWORD');
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new Error('PROVISION_SLUG: 2-40 caracteres a-z, 0-9 o guion');
  if (password.length < 12) throw new Error('PROVISION_ADMIN_PASSWORD debe tener al menos 12 caracteres');
  const app = await createApp();
  await app.init();
  try {
    const r = await app.get(ProvisionerService).createTenant({ slug, name, legalName: process.env.PROVISION_LEGAL_NAME, admin: { email, fullName: process.env.PROVISION_ADMIN_NAME ?? 'Administrador', password } } as any);
    console.log(`✅ Restaurante «${name}» creado (slug: ${slug}, tenant: ${r.tenantId}). Inicia sesión con ${email}.`);
  } finally { await app.close(); }
}
main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
