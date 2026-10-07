import { expect, test } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000';

test('plano: arrastrar una mesa a un lugar libre se guarda; encimar otra la devuelve', async ({ page, request }) => {
  const tok = (await (await request.post(`${API}/auth/login`, { data: { tenant: 'retroburger', email: 'admin@retroburger.test', password: 'Retro90!Burger' } })).json()).accessToken as string;
  const h = { authorization: `Bearer ${tok}` };
  const branch = (await (await request.get(`${API}/branches`, { headers: h })).json()).find((b: any) => b.code === 'CENTRO');
  const tables = async () => (await (await request.get(`${API}/tables?branchId=${branch.id}`, { headers: h })).json()) as any[];
  const t1 = (await tables()).find((t) => t.number === 1)!;
  await request.patch(`${API}/branches/${branch.id}/tables/${t1.id}/position`, { headers: h, data: { x: 0, y: 0 } });   // estado conocido

  await page.goto('/');
  await page.getByLabel('Correo').fill('admin@retroburger.test'); await page.getByLabel('Contraseña').fill('Retro90!Burger');
  await page.getByRole('button', { name: /^▶ entrar/i }).click(); await expect(page.locator('.rb-sidebar')).toBeVisible();
  await page.getByRole('link', { name: /Mesas/ }).click();
  await page.getByRole('button', { name: /🗺️ Plano/ }).click();
  await expect(page.getByTestId('plan-table-1')).toBeVisible();

  // sin modo edición, arrastrar no mueve: sólo abre la mesa
  await page.getByRole('button', { name: /Editar plano/ }).click();
  const box = async () => (await page.getByTestId('plan-table-1').boundingBox())!;
  const drag = async (dx: number, dy: number) => {
    const b = await box(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 4 }); await page.mouse.move(cx + dx, cy + dy, { steps: 4 }); await page.mouse.up();
  };

  await drag(104, 104);                                                   // (0,0) → (1,1): libre
  await expect.poll(async () => { const t = (await tables()).find((x) => x.number === 1)!; return [t.x, t.y]; }).toEqual([1, 1]);
  await page.screenshot({ path: 'shots/40-plano-editar.png' });

  await drag(104, -104);                                                  // (1,1) → (2,0): ocupada por la mesa 2
  await expect(page.getByText(/Ahí no cabe la mesa 1/)).toBeVisible();
  expect((await tables()).find((x) => x.number === 1)).toMatchObject({ x: 1, y: 1 });   // sigue donde estaba

  // teclado: flecha izquierda → (0,1)
  await page.getByTestId('plan-table-1').focus(); await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => { const t = (await tables()).find((x) => x.number === 1)!; return [t.x, t.y]; }).toEqual([0, 1]);

  // fuera de edición, clic abre la mesa
  await page.getByRole('button', { name: /Terminar edición/ }).click();
  await page.getByTestId('plan-table-2').click();
  await expect(page.getByRole('dialog').getByText('Mesa 2').first()).toBeVisible();

  await request.patch(`${API}/branches/${branch.id}/tables/${t1.id}/position`, { headers: h, data: { x: 0, y: 0 } });   // limpieza
});
