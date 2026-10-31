import { expect, test } from '@playwright/test';
test('new colony, fixed clock, canvas and tile selection', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'MARS: FIRST COLONY' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(
    page.getByRole('heading', { name: 'First Colony', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Skip landing' }).click();
  await expect(page.getByTestId('tick')).not.toHaveText('Sol clock: 0 ticks');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('selection')).toHaveText(/Sector/);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const beforeZoom = await canvas.screenshot();
  await page.mouse.wheel(0, -200);
  await expect
    .poll(async () => (await canvas.screenshot()).equals(beforeZoom))
    .toBe(false);
  const beforePan = await canvas.screenshot();
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 80,
    box.y + box.height / 2 + 40,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(beforePan))
    .toBe(false);
  expect(failures).toEqual([]);
});
