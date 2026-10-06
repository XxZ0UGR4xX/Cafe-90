import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000';
const SHOTS = 'shots';

// TOTP mínimo (RFC 6238) para actuar como la app de autenticación.
function totp(secretB32: string, offsetSteps = 0): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0; const key: number[] = [];
  for (const c of secretB32.replace(/\s/g, '')) { val = (val << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { key.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offsetSteps));
  const h = createHmac('sha1', Buffer.from(key)).update(msg).digest(); const o = h[h.length - 1]! & 15;
  return String((((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, '0');
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel('Correo').fill(email); await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: /press start/i }).click();
}

test('2FA: activar en Seguridad, cerrar sesión, entrar con código y con código de recuperación', async ({ page, request }) => {
  // usuario descartable (no toca la cuenta demo del admin)
  const tok = (await (await request.post(`${API}/auth/login`, { data: { tenant: 'retroburger', email: 'admin@retroburger.test', password: 'Retro90!Burger' } })).json()).accessToken;
  const email = `mfa-${randomUUID().slice(0, 6)}@retroburger.test`; const password = 'Retro90!Mfa-Test';
  const created = await request.post(`${API}/users`, { headers: { authorization: `Bearer ${tok}` }, data: { email, fullName: 'Prueba 2FA', password, roles: [{ role: 'ADMIN', branchIds: null }] } });
  expect(created.status()).toBe(201);

  await signIn(page, email, password);
  await expect(page.locator('.rb-sidebar')).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('tab', { name: /Seguridad/ }).click();
  await expect(page.getByText('Desactivada')).toBeVisible();
  await page.getByRole('button', { name: 'Activar 2FA' }).click();
  const secret = (await page.getByTestId('mfa-secret').textContent())!;
  await expect(page.getByAltText(/Código QR/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/20-mfa-setup.png` });
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Activar', exact: true }).click();
  const codes = await page.getByTestId('recovery-codes').locator('code').allTextContents();
  expect(codes).toHaveLength(10);
  await page.screenshot({ path: `${SHOTS}/21-mfa-recovery.png` });
  await page.getByText('Ya guardé mis códigos').click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('.rb-badge', { hasText: 'Activa' })).toBeVisible();

  // salir y volver a entrar: ahora pide el código
  await page.evaluate(async (api) => { await fetch(`${api}/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'x-requested-with': 'retroburger' } }).catch(() => {}); }, API);
  await page.context().clearCookies();
  await signIn(page, email, password);
  await expect(page.getByText('Código de verificación')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/22-mfa-challenge.png` });
  await page.getByLabel('Código', { exact: true }).fill('000000');
  await page.getByRole('button', { name: /Verificar/ }).click();
  await expect(page.getByText(/incorrecto o vencido/)).toBeVisible();
  await page.getByLabel('Código', { exact: true }).fill(totp(secret, 1));
  await page.getByRole('button', { name: /Verificar/ }).click();
  await expect(page.locator('.rb-sidebar')).toBeVisible();

  // con un código de recuperación
  await page.context().clearCookies(); await page.evaluate(() => sessionStorage.clear());
  await signIn(page, email, password);
  await page.getByLabel('Código', { exact: true }).fill(codes[0]!);
  await page.getByRole('button', { name: /Verificar/ }).click();
  await expect(page.locator('.rb-sidebar')).toBeVisible();
});
