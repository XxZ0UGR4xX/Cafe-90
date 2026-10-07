import { expect, test, type Page } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000';
const PUBLIC = process.env.E2E_PUBLIC_URL ?? 'http://localhost:5174';
const SHOTS = 'shots';

/** Cajero de la sucursal CENTRO (el mismo que usa pos-flow): la caja es de una sola persona por vez, así no se pisan las pruebas. */
async function cashierToken(request: any) {
  return (await (await request.post(`${API}/auth/login`, { data: { tenant: 'retroburger', email: 'cajero-centro@retroburger.test', password: 'Retro90!Staff' } })).json()).accessToken as string;
}
/** Crea y cobra una orden por API (con caja abierta) y devuelve id, número y código de autofactura. */
async function paidOrder(request: any) {
  const tok = await cashierToken(request); const h = { authorization: `Bearer ${tok}` };
  const branches = await (await request.get(`${API}/branches`, { headers: h })).json(); const b = branches.find((x: any) => x.code === 'CENTRO') ?? branches[0];
  await request.post(`${API}/cash/shifts/open`, { headers: h, data: { branchId: b.id, openingFloat: 100 } });
  const menu = await (await request.get(`${API}/products?limit=50`, { headers: h })).json();
  const prod = menu.find((p: any) => p.kind === 'SIMPLE' && p.isAvailable && !p.stationKey) ?? menu.find((p: any) => p.kind === 'SIMPLE' && p.isAvailable);
  const o = await (await request.post(`${API}/orders`, { headers: h, data: { branchId: b.id, channel: 'TAKEAWAY', items: [{ productId: prod.id, qty: 2, modifierIds: [], comboChoices: [] }], send: true } })).json();
  const pay = await request.post(`${API}/orders/${o.id}/pay`, { headers: h, data: { payments: [{ method: 'CASH', amount: o.total }] } });
  expect(pay.status(), await pay.text()).toBe(200);
  return { id: o.id as string, number: o.number as number, total: o.total as number, token: tok, branchId: b.id as string };
}

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Correo').fill('admin@retroburger.test'); await page.getByLabel('Contraseña').fill('Retro90!Burger');
  await page.getByRole('button', { name: /^▶ entrar/i }).click(); await expect(page.locator('.rb-sidebar')).toBeVisible();
}

test('Pedidos → Facturar: valida datos, timbra (simulado) y muestra la factura', async ({ page, request }) => {
  const o = await paidOrder(request);
  await signIn(page);
  await page.getByRole('link', { name: /Pedidos/ }).click();
  await page.getByRole('tab', { name: /Completados/ }).click();
  await page.getByText(`#${String(o.number).padStart(4, '0')}`).first().click();
  await page.getByRole('button', { name: /Facturar/ }).click();
  await page.getByLabel('RFC', { exact: true }).fill('URE180429TM6');
  await page.getByLabel('Código postal fiscal').fill('65000');
  await page.getByLabel(/Nombre o razón social/).fill('Universidad Robotica Española S.A. de C.V.');
  await page.getByLabel('Régimen fiscal').selectOption('601');
  await expect(page.getByLabel('Uso del CFDI')).toHaveValue('G03');
  await page.screenshot({ path: `${SHOTS}/30-factura-form.png` });
  await page.getByRole('button', { name: /Timbrar factura/ }).click();
  await expect(page.getByText(/Factura A-\d+/).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('SIMULADO · sin validez fiscal')).toBeVisible();
  await expect(page.getByText('UNIVERSIDAD ROBOTICA ESPAÑOLA').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/31-factura-detalle.png` });
  // el XML se descarga
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /XML/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^CFDI-A-\d+-[0-9A-F]{8}\.xml$/);
});

test('sitio público: autofactura con el código del ticket', async ({ page, request }) => {
  const o = await paidOrder(request);
  const code = await (async () => {
    const t = await (await request.get(`${API}/orders/${o.id}/receipt.txt`, { headers: { authorization: `Bearer ${o.token}` } })).text();
    return /Código: ([0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4})/.exec(t)![1]!;
  })();
  await page.goto(`${PUBLIC}/factura`);
  await page.getByLabel('Código del ticket').fill(code);
  await page.getByRole('button', { name: 'Buscar ticket' }).click();
  await expect(page.getByText(`Ticket #${String(o.number).padStart(4, '0')}`)).toBeVisible();
  await page.getByLabel('RFC', { exact: true }).fill('URE180429TM6');
  await page.getByLabel('Código postal fiscal').fill('65000');
  await page.getByLabel('Nombre o razón social').fill('Universidad Robotica Española');
  await page.getByLabel('Régimen fiscal').selectOption('601');
  await page.screenshot({ path: `${SHOTS}/32-autofactura.png`, fullPage: true });
  await page.getByRole('button', { name: /Generar factura/ }).click();
  await expect(page.getByText('¡Factura generada!')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Ya facturado')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/33-autofactura-ok.png`, fullPage: true });
  // volver a buscar el ticket: ya no se puede facturar de nuevo
  await page.getByRole('button', { name: 'Buscar ticket' }).click();
  await expect(page.getByLabel('Código postal fiscal')).toHaveCount(0);
});
