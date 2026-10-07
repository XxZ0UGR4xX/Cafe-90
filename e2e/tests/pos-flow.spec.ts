import { expect, test, type Page } from '@playwright/test';

const S = 'shots';
async function login(page: Page, email: string, password = 'Retro90!Staff') {
  await page.goto('/'); await page.getByLabel('Correo').fill(email); await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: /^▶ entrar/i }).click(); await expect(page.locator('.rb-sidebar')).toBeVisible();
}

test('venta completa: mesa → POS → cocina (KDS) → cobro → caja', async ({ page, browser }) => {
  await login(page, 'cajero-centro@retroburger.test');
  await page.getByRole('link', { name: /POS/ }).click();
  await expect(page.locator('.rb-product').first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${S}/03-pos.png` });

  // mesa 3
  await page.getByRole('button', { name: /Elegir mesa/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Libre/ }).first().click();
  // hamburguesa con modificadores
  await page.getByRole('button', { name: /^Retro Burger/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dlg = page.getByRole('dialog'); await dlg.getByText('Queso extra').click(); await dlg.getByText('Cebolla').first().click();
  await page.screenshot({ path: `${S}/04-modifiers.png` });
  await page.getByRole('button', { name: /Agregar/ }).click();
  await page.getByRole('button', { name: /^Papas Clásicas/ }).click();
  await page.getByRole('button', { name: /^Cola Retro/ }).click(); await page.getByRole('button', { name: /Regular/ }).click(); await page.getByRole('button', { name: /Agregar/ }).click();
  await page.screenshot({ path: `${S}/05-ticket.png` });
  await page.getByRole('button', { name: /Enviar cocina/ }).click();
  await expect(page.getByText(/enviada a cocina/)).toBeVisible();

  // KDS ve los tickets
  await page.getByRole('link', { name: /Cocina/ }).click();
  await expect(page.locator('.rb-kticket').first()).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${S}/06-kds.png` });
  for (let i = 0; i < 3; i++) { // preparar y listo cada ticket
    for (const _ of [1, 2]) { const t = page.locator('.rb-kds__col').nth(_ === 1 ? 0 : 1).locator('.rb-kticket').first(); if (await t.count()) await t.click(); }
  }
  await page.waitForTimeout(500);

  // cobro
  await page.getByRole('link', { name: /POS/ }).click();
  await page.getByRole('button', { name: /Cobrar/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: `${S}/07-pay.png` });
  // sin caja → pide abrir caja
  const open = page.getByRole('button', { name: /Abrir caja y continuar/ });
  await page.getByRole('button', { name: /✔ Cobrar/ }).click();
  await open.waitFor({ timeout: 8000 }).catch(() => undefined);
  if (await open.isVisible()) { await open.click(); await expect(page.getByRole('button', { name: /✔ Cobrar/ })).toBeVisible(); await page.getByRole('button', { name: /✔ Cobrar/ }).click(); }
  await expect(page.getByRole('heading', { name: /Venta completada/ })).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${S}/08-done.png` });
  void browser;
});

test('mesas y mapa responsive (tablet)', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1100 });
  await login(page, 'mesero1-centro@retroburger.test');
  await page.getByLabel('Abrir menú').click(); await page.getByRole('link', { name: /Mesas/ }).click();
  await expect(page.locator('.rb-table-card').first()).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${S}/09-tables-tablet.png` });
});
