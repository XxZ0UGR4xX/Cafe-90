import { expect, test } from '@playwright/test';

// Regresión: al teclear en el 2.º campo de un modal, el foco saltaba al 1.º y el texto caía en el campo equivocado.
// `fill()` no lo detecta (no depende del foco): aquí se teclea como una persona.
test('modal: se puede teclear de corrido en cualquier campo y el Tab no se escapa del diálogo', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('Correo').fill('admin@retroburger.test'); await page.getByLabel('Contraseña').fill('Retro90!Burger');
  await page.getByRole('button', { name: /^▶ entrar/i }).click(); await expect(page.locator('.rb-sidebar')).toBeVisible();
  await page.locator('.rb-sidebar a[href="/customers"]').click(); await page.getByRole('button', { name: '+ Cliente' }).click();
  await page.getByLabel('Teléfono').click(); await page.keyboard.type('5551234567', { delay: 25 });
  expect(await page.getByLabel('Teléfono').inputValue()).toBe('5551234567');
  expect(await page.getByLabel('Nombre', { exact: true }).inputValue()).toBe('');
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});
