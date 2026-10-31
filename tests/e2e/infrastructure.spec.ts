import { expect, test, type Page } from '@playwright/test';
import {
  findLandingZone,
  port,
  deployColony,
  newGame,
} from '../../packages/simulation/src/index.js';
import { tileToWorld } from '../../apps/web/src/iso.js';
async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'Skip landing' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
}
async function point(page: Page, x: number, y: number) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('Missing canvas');
  const zone = findLandingZone(1),
    center = tileToWorld(zone.x, zone.y),
    p = tileToWorld(x, y);
  return {
    x: box.x + box.width / 2 + p.x - center.x,
    y: box.y + box.height / 2 + p.y - center.y,
  };
}
async function selectType(page: Page, name: string) {
  await page
    .getByRole('button', { name: 'Infrastructure', exact: true })
    .click();
  await page.getByRole('button', { name: new RegExp(`^${name} `) }).click();
}
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const a = await point(page, from.x, from.y),
    b = await point(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}
async function saved(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
}
test('drag previews costs, cancels free, commits layered routes and demolishes with refund', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  await selectType(page, 'Water Pipe');
  await drag(page, { x: 2, y: 8 }, { x: 2, y: 10 });
  await expect(page.getByTestId('route-cost')).toContainText(
    'Cost: 0.75 metal',
  );
  expect((await saved(page)).inventory.metal).toBe(80);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Confirm route' })).toHaveCount(
    0,
  );
  expect((await saved(page)).inventory.metal).toBe(80);
  await selectType(page, 'Water Pipe');
  await drag(page, { x: 2, y: 8 }, { x: 2, y: 10 });
  await page.getByRole('button', { name: 'Confirm route' }).click();
  expect((await saved(page)).inventory.metal).toBe(79.25);
  await page.keyboard.press('Escape');
  await selectType(page, 'Electrical Cable');
  await drag(page, { x: 2, y: 8 }, { x: 2, y: 10 });
  await page.getByRole('button', { name: 'Confirm route' }).click();
  let state = await saved(page);
  expect(state.inventory.metal).toBe(77.75);
  expect(
    state.infrastructure.filter(
      (s: { x: number; y: number }) => s.x === 2 && s.y === 9,
    ),
  ).toHaveLength(2);
  await page
    .getByRole('button', { name: 'Demolish tool', exact: true })
    .click();
  await drag(page, { x: 2, y: 8 }, { x: 2, y: 10 });
  await expect(page.getByTestId('route-cost')).toContainText(
    'Refund: 0.75 metal',
  );
  await page.getByRole('button', { name: 'Confirm route' }).click();
  state = await saved(page);
  expect(state.inventory.metal).toBe(78.5);
  expect(
    state.infrastructure.filter(
      (s: { x: number; y: number }) => s.x === 2 && s.y === 9,
    ),
  ).toHaveLength(1);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  expect((await saved(page)).infrastructure).toEqual(state.infrastructure);
  expect(errors).toEqual([]);
});
test('port removal immediately disconnects a habitat and network overlays reflect real components', async ({
  page,
}) => {
  await start(page);
  const state = deployColony(newGame(1)),
    house = state.buildings.find((b) => b.type === 'housing')!,
    endpoint = port(house, 'water')!;
  await page
    .getByLabel('Network display', { exact: true })
    .selectOption('water');
  const before = await page.locator('canvas').screenshot();
  await page
    .getByLabel('Network display', { exact: true })
    .selectOption('power');
  await expect
    .poll(async () =>
      (await page.locator('canvas').screenshot()).equals(before),
    )
    .toBe(false);
  await selectType(page, 'Water Pipe');
  await page
    .getByRole('button', { name: 'Demolish tool', exact: true })
    .click();
  await drag(page, endpoint, endpoint);
  await page.getByRole('button', { name: 'Confirm route' }).click();
  await page.keyboard.press('Escape');
  await page.getByText('Building roster (19)', { exact: true }).click();
  await page
    .getByRole('button', { name: /^Modular housing ·/ })
    .first()
    .click();
  await expect(page.getByTestId('building-status')).toHaveText(
    'No water connection',
  );
  await expect(page.getByTestId('network-inspector')).toContainText(
    'No water connection',
  );
  await page.getByRole('button', { name: '1×', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Alerts' })).toContainText(
    'Critical: unmet water demand',
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const stored = await saved(page);
  expect(stored.schemaVersion).toBe(4);
  expect(stored.telemetry.unmet.water).toBeGreaterThan(0);
  await page
    .getByRole('spinbutton', { name: 'Power priority', exact: true })
    .fill('5');
  await page
    .getByTestId('network-inspector')
    .getByRole('button', { name: 'Disable segment', exact: true })
    .first()
    .click();
  await expect(page.getByTestId('network-inspector')).toContainText(
    'No oxygen connection',
  );
  const updated = await saved(page);
  expect(
    updated.buildings.find((b: { id: string }) => b.id === house.id).priority,
  ).toBe(5);
  const oxygenPort = port(house, 'oxygen')!;
  expect(
    updated.infrastructure.find(
      (s: { type: string; x: number; y: number }) =>
        s.type === 'oxygen' && s.x === oxygenPort.x && s.y === oxygenPort.y,
    ).enabled,
  ).toBe(false);
});
test('invalid building overlap is red and right click cancels without spending', async ({
  page,
}) => {
  await start(page);
  await selectType(page, 'Road');
  const zone = findLandingZone(1);
  await drag(page, zone, zone);
  await expect(page.getByTestId('route-preview')).toContainText(
    'Building footprint is occupied',
  );
  await expect(
    page.getByRole('button', { name: 'Confirm route' }),
  ).toBeDisabled();
  const p = await point(page, zone.x, zone.y);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.getByTestId('route-preview')).toHaveCount(0);
  expect((await saved(page)).inventory.metal).toBe(80);
});
