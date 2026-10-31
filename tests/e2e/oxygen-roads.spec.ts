import { expect, test } from '@playwright/test';
import {
  buildInfrastructure,
  construct,
  deployColony,
  findLandingZone,
  newGame,
  refreshNetworks,
  routeBetween,
} from '../../packages/simulation/src/index.js';
import { tileToWorld } from '../../apps/web/src/iso.js';
test('a home uses side-only oxygen and reports both adjacent road components', async ({
  page,
}) => {
  let s = construct(deployColony(newGame()), 'housing', { x: 2, y: 9 });
  const home = s.buildings.at(-1)!;
  s = refreshNetworks({
    ...s,
    infrastructure: s.infrastructure.filter(
      (i) => i.type !== 'oxygen' && i.type !== 'road',
    ),
  });
  s = buildInfrastructure(s, 'oxygen', [
    ...routeBetween({ x: 1, y: 9 }, { x: 1, y: 11 }),
    ...routeBetween({ x: 1, y: 11 }, { x: 3, y: 11 }),
  ]);
  s = buildInfrastructure(
    buildInfrastructure(s, 'road', [{ x: 1, y: 9 }]),
    'road',
    [{ x: 3, y: 9 }],
  );
  s.residents[0]!.homeId = home.id;
  s.speed = 0;
  await page.goto('/');
  await page.evaluate(
    (save) =>
      localStorage.setItem('mars-first-colony-save', JSON.stringify(save)),
    s,
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('Missing canvas');
  const zone = findLandingZone(1),
    center = tileToWorld(zone.x, zone.y),
    p = tileToWorld(home.x, home.y);
  await page.mouse.click(
    box.x + box.width / 2 + p.x - center.x,
    box.y + box.height / 2 + p.y - center.y,
  );
  await expect(
    page
      .getByTestId('building-inspector')
      .getByRole('heading', { name: 'Modular housing', exact: true }),
  ).toBeVisible();
  const inspector = page.getByTestId('network-inspector'),
    oxygen = inspector
      .locator('article')
      .filter({ has: page.getByText('Oxygen Pipe', { exact: true }) }),
    road = inspector
      .locator('article')
      .filter({ has: page.getByText('Road', { exact: true }) });
  await expect(oxygen).toContainText('Connected');
  await expect(oxygen).toContainText('Automatic contact: 1, 9');
  await expect(oxygen).toContainText('any directly adjacent side');
  await expect(road).toContainText('Connected');
  await expect(road).toContainText('All adjacent road components');
  await expect(road).toContainText('net-road:1,9');
  await expect(road).toContainText('net-road:3,9');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(saved.inventory.oxygen).toBe(100);
  expect(saved.networkRulesVersion).toBe(4);
});
