import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PUBLIC = process.env.E2E_PUBLIC_URL ?? 'http://localhost:5174';
const ROUTES: [string, string][] = [
  ['/', 'Dashboard'], ['/pos', 'POS'], ['/tables', 'Mesas'], ['/orders', 'Pedidos'], ['/kitchen', 'Cocina'], ['/delivery', 'Delivery'], ['/inventory', 'Inventario'],
  ['/purchasing', 'Compras'], ['/menu', 'Menú'], ['/customers', 'Clientes'], ['/staff', 'Empleados'], ['/reservations', 'Reservaciones'], ['/promotions', 'Promociones'],
  ['/reports', 'Reportes'], ['/cash', 'Caja'], ['/invoices', 'Facturas'], ['/audit', 'Auditoría'], ['/settings', 'Configuración'],
];
const scan = async (page: Page) => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
  .filter((v) => v.impact === 'serious' || v.impact === 'critical')
  .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ') }));

test('accesibilidad: login y pantallas del admin sin violaciones serias/críticas (WCAG 2.1 AA)', async ({ page }) => {
  test.setTimeout(240_000);
  const report: Record<string, unknown[]> = {};
  await page.goto('/'); await page.waitForSelector('form');
  report['Login'] = await scan(page);
  await page.getByLabel('Correo').fill('admin@retroburger.test'); await page.getByLabel('Contraseña').fill('Retro90!Burger');
  await page.getByRole('button', { name: /^▶ entrar/i }).click(); await expect(page.locator('.rb-sidebar')).toBeVisible();
  for (const [path, name] of ROUTES) {
    // navegación dentro de la SPA (el tiempo real mantiene conexiones abiertas: «networkidle» nunca llega)
    await page.locator(`.rb-sidebar a[href="${path}"]`).click(); await page.waitForTimeout(900);
    report[name] = await scan(page);
  }
  const bad = Object.entries(report).filter(([, v]) => v.length);
  console.log('A11Y', JSON.stringify(Object.fromEntries(bad), null, 1));
  expect(bad.map(([k]) => k)).toEqual([]);
});

test('accesibilidad: sitio público (menú, reservar, puntos, facturar)', async ({ page }) => {
  const report: Record<string, unknown[]> = {};
  for (const [path, name] of [['/', 'Menú'], ['/reservar', 'Reservar'], ['/puntos', 'Puntos'], ['/factura', 'Facturar']] as const) {
    await page.goto(`${PUBLIC}${path}`); await page.waitForTimeout(900);
    report[name] = await scan(page);
  }
  const bad = Object.entries(report).filter(([, v]) => v.length);
  console.log('A11Y-PUBLIC', JSON.stringify(Object.fromEntries(bad), null, 1));
  expect(bad.map(([k]) => k)).toEqual([]);
});

test('accesibilidad: diálogos y pestañas (producto, cobro, mesa, pedido, factura, 2FA, ajustes)', async ({ page }) => {
  test.setTimeout(240_000);
  const report: Record<string, unknown[]> = {};
  const check = async (name: string) => { await page.waitForTimeout(500); report[name] = await scan(page); };
  await page.goto('/'); await page.getByLabel('Correo').fill('admin@retroburger.test'); await page.getByLabel('Contraseña').fill('Retro90!Burger');
  await page.getByRole('button', { name: /^▶ entrar/i }).click(); await expect(page.locator('.rb-sidebar')).toBeVisible();
  const go = async (path: string) => { await page.locator(`.rb-sidebar a[href="${path}"]`).click(); await page.waitForTimeout(800); };

  await go('/settings');
  for (const tab of await page.getByRole('tab').all()) { const label = (await tab.textContent())?.trim() ?? 'tab'; await tab.click(); await check(`Ajustes · ${label}`); }
  await page.getByRole('tab', { name: /Seguridad/ }).click(); await page.getByRole('button', { name: 'Activar 2FA' }).click(); await check('Diálogo · activar 2FA'); await page.keyboard.press('Escape');

  await go('/pos');
  await page.locator('.rb-product, [data-testid="product-card"], button.rb-prod').first().click({ timeout: 4000 }).catch(async () => { await page.getByText('Regular').first().click(); });
  await check('Diálogo · producto con modificadores'); await page.keyboard.press('Escape');

  await go('/tables');
  await page.getByRole('button', { name: /Mesa \d+/ }).first().click(); await check('Diálogo · mesa'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /🗺️ Plano/ }).click(); await check('Plano de mesas'); await page.getByRole('button', { name: /Editar plano/ }).click(); await check('Plano en edición');

  await go('/orders');
  await page.getByRole('tab', { name: /Completados/ }).click(); await page.waitForTimeout(500);
  await page.locator('.rb-order-card, [class*="order"]').first().click().catch(() => undefined);
  await check('Diálogo · detalle de pedido');
  const fact = page.getByRole('button', { name: /Facturar|Factura A-/ }).first();
  if (await fact.isVisible().catch(() => false)) { await fact.click(); await check('Diálogo · facturar / factura'); }
  await page.keyboard.press('Escape');

  const bad = Object.entries(report).filter(([, v]) => v.length);
  console.log('A11Y-DIALOGS', JSON.stringify(Object.fromEntries(bad), null, 1), '· escaneados:', Object.keys(report).length);
  expect(bad.map(([k]) => k)).toEqual([]);
});
