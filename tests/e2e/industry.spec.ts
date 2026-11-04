import { expect, test, type Page } from '@playwright/test';
import { charged, mine, run } from '../helpers/industry.js';
import type { ColonyState } from '../../packages/simulation/src/index.js';
async function load(page: Page, state: ColonyState) {
  state.speed = 0;
  await page.goto('/');
  await page.evaluate(
    (s) => localStorage.setItem('mars-first-colony-save', JSON.stringify(s)),
    state,
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
}
test('queues a geological survey, reveals only discovered minerals, and inspects them on the overlay', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, charged());
  await expect(
    page.getByRole('button', { name: 'Mining', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText('Discovered deposits (0)', { exact: true }),
  ).toBeVisible();
  const geology = page.getByRole('region', { name: 'Geological operations' });
  await page.getByLabel('Scan x2', { exact: true }).fill('21');
  await page.getByLabel('Map terrain too', { exact: false }).check();
  await page
    .getByRole('button', { name: 'Queue geological scan', exact: true })
    .click();
  await page.getByRole('button', { name: '4×', exact: true }).click();
  await expect(
    geology.getByText('Discovered deposits (1)', { exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await geology.getByText('Discovered deposits (1)', { exact: true }).click();
  await geology
    .getByRole('button', { name: /Iron-bearing ore · 21,24/ })
    .click();
  await expect(page.getByTestId('deposit-inspector')).toContainText(
    'surface technology',
  );
  await expect(page.getByTestId('deposit-inspector')).toContainText(
    '8042.00 kg',
  );
  await expect(page.getByLabel('Network display')).toHaveValue('geology');
  await expect(
    geology.getByRole('button', { name: /Lithium-bearing/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(saved.schemaVersion).toBe(8);
  expect(
    saved.world.chunks['1,1'].deposits.filter(
      (d: { discovered: boolean }) => d.discovered,
    ),
  ).toHaveLength(1);
  expect(errors).toEqual([]);
});
test('storage reads actual mine buffers, preserves them through reload and opens mine inspection', async ({
  page,
}) => {
  let state = mine();
  state = run(state, 65);
  expect(state.industry.mines[0]!.quantity).toBeGreaterThan(0);
  await load(page, state);
  await page
    .getByRole('button', { name: 'Storage overview', exact: true })
    .click();
  const overview = page.getByRole('region', { name: 'Storage overview' });
  const id = state.industry.mines[0]!.buildingId;
  await expect(overview.getByTestId(`mine-buffer-${id}`)).toContainText(
    `${state.industry.mines[0]!.quantity.toFixed(2)} / 40`,
  );
  await expect(overview.getByTestId('storage-metal')).toContainText(
    state.inventory.metal.toFixed(2),
  );
  await expect(overview).toContainText(
    'Cargo logistics and refining are pending',
  );
  await page.getByRole('button', { name: '4×', exact: true }).click();
  await expect(overview.getByTestId(`mine-buffer-${id}`)).not.toContainText(
    `${state.industry.mines[0]!.quantity.toFixed(2)} / 40`,
    { timeout: 15000 },
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(after.industry).toEqual(before.industry);
  expect(after.world).toEqual(before.world);
  await overview
    .getByRole('button', { name: new RegExp(`Iron-bearing ore · ${id}`) })
    .click();
  await expect(page.getByTestId('building-inspector')).toContainText(
    'Surface mine',
  );
  await expect(page.getByTestId('building-inspector')).toContainText(
    'Local raw mineral buffer',
  );
});
