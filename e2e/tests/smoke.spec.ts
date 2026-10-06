import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'shots';
async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel('Correo').fill(email); await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: /press start/i }).click();
  await expect(page.locator('.rb-sidebar')).toBeVisible();
}

test('login visual + dashboard corporativo', async ({ page }) => {
  await page.goto('/'); await page.screenshot({ path: `${SHOTS}/01-login.png` });
  await login(page, 'admin@retroburger.test', 'Retro90!Burger');
  await expect(page.getByText('Ventas de hoy')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800); await page.screenshot({ path: `${SHOTS}/02-dashboard.png`, fullPage: true });
});
