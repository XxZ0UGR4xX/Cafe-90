import { expect, test } from '@playwright/test';

const PUB = process.env.E2E_PUBLIC_URL ?? 'http://localhost:5174';
test('sitio público: pedir para recoger y rastrear', async ({ page }) => {
  await page.goto(PUB); await expect(page.locator('.rb-product').first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'shots/10-public-menu.png' });
  await page.getByRole('button', { name: /^Banderillas/ }).click();
  await page.getByRole('button', { name: /^Malteada/ }).click(); await page.getByRole('button', { name: /Vainilla/ }).click(); await page.getByRole('dialog').getByRole('button', { name: /Agregar/ }).click();
  await page.getByLabel('Nombre').fill('Marty McFly'); await page.getByLabel('Teléfono').fill('5551112233');
  await page.screenshot({ path: 'shots/11-public-cart.png' });
  await page.getByRole('button', { name: /Hacer pedido/ }).click();
  await expect(page.getByText(/Pedido #/)).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'shots/12-public-track.png' });
});

test('QR de mesa: pedir y llamar mesero', async ({ page, request }) => {
  const login = await request.post('http://localhost:3000/auth/login', { data: { tenant: 'retroburger', email: 'admin@retroburger.test', password: 'Retro90!Burger' } });
  const token = (await login.json()).accessToken;
  const branches = await (await request.get('http://localhost:3000/branches', { headers: { authorization: `Bearer ${token}` } })).json();
  const tables = await (await request.get(`http://localhost:3000/tables?branchId=${branches[0].id}`, { headers: { authorization: `Bearer ${token}` } })).json();
  const qr = tables.find((t: any) => t.status === 'FREE').qrToken;
  await page.goto(`${PUB}/m/${qr}`); await expect(page.getByRole('heading', { name: /MESA/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /^Banderillas/ }).click();
  await page.getByRole('button', { name: /Enviar pedido a mi mesa/ }).click();
  await expect(page.getByText(/Pedido enviado/)).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /Llamar mesero/ }).click(); await expect(page.getByText(/Avisamos a tu mesero/)).toBeVisible();
  await page.screenshot({ path: 'shots/13-public-qr.png' });
});
