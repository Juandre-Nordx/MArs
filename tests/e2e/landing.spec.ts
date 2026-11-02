import { expect, test } from '@playwright/test';
test('real new-game creation lands at the map centre and preserves it through save/load', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'Skip landing', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByLabel('Map X', { exact: true })).toHaveValue('256');
  await expect(page.getByLabel('Map Y', { exact: true })).toHaveValue('256');
  await expect(page.getByLabel('Scan x1', { exact: true })).toHaveValue('261');
  await expect(page.getByLabel('Scan y1', { exact: true })).toHaveValue('264');
  await expect(page.getByLabel('Scan mode', { exact: true })).toHaveValue(
    'subsurface',
  );
  const canvas = page.locator('canvas'),
    box = await canvas.boundingBox();
  if (!box) throw new Error('Missing central world canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('selection')).toHaveText('Sector 256, 256');
  await expect(page.getByTestId('building-inspector')).toContainText(
    'Starship command centre',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(before.landingZone).toEqual({ x: 256, y: 256 });
  expect(before.world.generatorVersion).toBe(2);
  expect(before.buildings).toHaveLength(19);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(after.landingZone).toEqual(before.landingZone);
  expect(after.buildings).toEqual(before.buildings);
  expect(after.world).toEqual(before.world);
});
