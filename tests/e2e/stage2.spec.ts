import { expect, test, type Page } from '@playwright/test';
import { findLandingZone } from '../../packages/simulation/src/index.js';
import { tileToWorld } from '../../apps/web/src/iso.js';
async function start(page: Page, skip = true) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Starship descending' }),
  ).toBeVisible();
  await expect(page.getByTestId('tick')).toHaveText('Sol clock: 0 ticks');
  if (skip) await page.getByRole('button', { name: 'Skip landing' }).click();
  await expect(
    page.getByText('Building roster (19)', { exact: true }),
  ).toBeVisible({ timeout: 10000 });
}
async function pause(page: Page) {
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
}
async function clickTile(page: Page, x: number, y: number) {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No canvas');
  const zone = findLandingZone(1);
  const center = tileToWorld(zone.x, zone.y);
  const point = tileToWorld(x, y);
  await page.mouse.click(
    box.x + box.width / 2 + point.x - center.x,
    box.y + box.height / 2 + point.y - center.y,
  );
}
test('automatic landing, inspection, pause/speed, save/load and restart are functional', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page, false); // Completes the actual animation, not its skip path.
  await pause(page);
  const tick = await page.getByTestId('tick').innerText();
  const oxygen = await page.getByTestId('resource-oxygen').innerText();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId('tick')).toHaveText(tick);
  await page.getByRole('button', { name: '4×', exact: true }).click();
  await expect(page.getByTestId('tick')).not.toHaveText(tick);
  await expect(page.getByTestId('resource-oxygen')).not.toHaveText(oxygen);
  await pause(page);
  const zone = findLandingZone(1);
  await clickTile(page, zone.x, zone.y);
  await expect(
    page
      .getByTestId('building-inspector')
      .getByRole('heading', { name: 'Starship command centre' }),
  ).toBeVisible();
  await page.getByText('Building roster (19)', { exact: true }).click();
  for (const name of [
    'Modular housing',
    'Oxygen generator',
    'Oxygen storage tank',
    'Water recycling plant',
    'Water storage tank',
    'Hydroponic farm',
    'Solar power system',
    'Energy storage system',
    'Warehouse',
  ]) {
    await page
      .getByRole('button', { name: new RegExp(`^${name} ·`) })
      .first()
      .click();
    await expect(
      page
        .getByTestId('building-inspector')
        .getByRole('heading', { name, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: /^Oxygen generator ·/ }).click();
  await page
    .getByRole('button', { name: 'Disable building', exact: true })
    .click();
  await expect(page.getByTestId('building-status')).toHaveText('disabled');
  await page
    .getByRole('button', { name: 'Enable building', exact: true })
    .click();
  await expect(page.getByTestId('building-status')).toHaveText('ready');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(
    page.getByText('Building roster (19)', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip landing' })).toHaveCount(
    0,
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'Skip landing' }).click();
  await expect(
    page.getByText('Building roster (19)', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('construction preview rejects collision and places a paid housing unit', async ({
  page,
}) => {
  await start(page);
  await pause(page);
  await page.getByRole('button', { name: 'Housing', exact: true }).click();
  await page.getByRole('button', { name: /^Modular housing/ }).click();
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('placement-status')).toContainText(
    'Building footprint is occupied',
  );
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(
    page.getByText('Building roster (19)', { exact: true }),
  ).toBeVisible();
  await clickTile(page, 2, 9);
  await expect(
    page.getByText('Building roster (20)', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId('building-inspector')
      .getByRole('heading', { name: 'Modular housing', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(stored.inventory.metal).toBe(72);
  expect(stored.credits).toBe(95);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(
    page.getByText('Building roster (20)', { exact: true }),
  ).toBeVisible();
});
test('landing saves deploy once; low reserve alerts reflect loaded simulation state', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByRole('button', { name: 'Skip landing' }).click();
  await pause(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('mars-first-colony-save')!);
    save.inventory.oxygen = 1;
    for (const b of save.buildings)
      b.stores.oxygen = b.type === 'oxygen-tank' ? 1 : 0;
    localStorage.setItem('mars-first-colony-save', JSON.stringify(save));
  });
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Alerts' })).toContainText(
    'Low oxygen reserves',
  );
  await expect(page.getByTestId('resource-oxygen')).toHaveText('1.00');
  await expect(
    page.getByText('Building roster (19)', { exact: true }),
  ).toBeVisible();
});
