import { test, expect } from '@playwright/test';
import {
  deployColony,
  newGame,
  revealArea,
} from '../../packages/simulation/src/index.js';
async function navigate(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
) {
  await page.getByLabel('Map X', { exact: true }).fill(String(x));
  await page.getByLabel('Map Y', { exact: true }).fill(String(y));
  await page.getByRole('button', { name: 'Go to tile', exact: true }).click();
}
test('512 world navigation keeps fog hidden and returns to the colony', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const state = deployColony(newGame());
  state.speed = 0;
  await page.goto('/');
  await page.evaluate(
    (s) => localStorage.setItem('mars-first-colony-save', JSON.stringify(s)),
    state,
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByTestId('world-size')).toHaveText(
    '512 × 512 tiles · 400 explored',
  );
  await navigate(page, 300, 300);
  await expect(page.getByTestId('terrain-region')).toContainText(
    'Unexplored terrain',
  );
  const world = page.getByLabel('Isometric Mars terrain');
  await expect
    .poll(async () => Number(await world.getAttribute('data-terrain-tiles')))
    .toBe(0);
  await expect
    .poll(async () => Number(await world.getAttribute('data-building-sprites')))
    .toBe(0);
  await expect
    .poll(async () =>
      Number(await world.getAttribute('data-infrastructure-sprites')),
    )
    .toBe(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(saved.world).toEqual(state.world);
  expect(saved.inventory).toEqual(state.inventory);
  await page
    .getByRole('button', { name: 'Return to colony', exact: true })
    .click();
  await expect
    .poll(async () => Number(await world.getAttribute('data-terrain-tiles')))
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
test('fully explored 512 world renders bounded chunks at far coordinates and preserves deposits through reload', async ({
  page,
}) => {
  const state = deployColony(newGame());
  state.speed = 0;
  state.world = revealArea(
    state.world,
    state.seed,
    { x: 0, y: 0 },
    { x: 511, y: 511 },
  );
  state.world.chunks['31,31']!.deposits[0]!.remainingQuantity = 17;
  await page.goto('/');
  await page.evaluate(
    (s) => localStorage.setItem('mars-first-colony-save', JSON.stringify(s)),
    state,
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await navigate(page, 500, 500);
  await expect(page.getByTestId('terrain-region')).toContainText('Region:');
  const world = page.getByLabel('Isometric Mars terrain');
  await world.hover();
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(250);
  const chunks = Number(await world.getAttribute('data-terrain-chunks')),
    tiles = Number(await world.getAttribute('data-terrain-tiles'));
  expect(chunks).toBeGreaterThan(0);
  expect(chunks).toBeLessThanOrEqual(64);
  expect(tiles).toBeLessThanOrEqual(16384);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(saved.schemaVersion).toBe(5);
  expect(saved.world.chunks['31,31'].deposits[0].remainingQuantity).toBe(17);
  expect(saved.inventory).toEqual(state.inventory);
});
