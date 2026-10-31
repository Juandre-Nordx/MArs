import { expect, test } from '@playwright/test';
import {
  buildInfrastructure,
  deployColony,
  findLandingZone,
  newGame,
  refreshNetworks,
  routeBetween,
  step,
} from '../../packages/simulation/src/index.js';
import { tileToWorld } from '../../apps/web/src/iso.js';
test('a company receives electricity through a side cable and loses it when that contact is disabled', async ({
  page,
}) => {
  let s = deployColony(newGame());
  s = refreshNetworks({
    ...s,
    infrastructure: s.infrastructure.filter((i) => i.type !== 'power'),
  });
  s = step(
    buildInfrastructure(
      s,
      'power',
      routeBetween({ x: 3, y: 8 }, { x: 3, y: 14 }),
    ),
  );
  s.speed = 0;
  await page.goto('/');
  await page.evaluate(
    (save) =>
      localStorage.setItem('mars-first-colony-save', JSON.stringify(save)),
    s,
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const company = s.buildings.find((b) => b.type === 'oxygen-generator')!,
    box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('Missing canvas');
  const z = findLandingZone(1),
    center = tileToWorld(z.x, z.y),
    p = tileToWorld(company.x, company.y);
  await page.mouse.click(
    box.x + box.width / 2 + p.x - center.x,
    box.y + box.height / 2 + p.y - center.y,
  );
  await expect(page.getByTestId('building-status')).toHaveText('running');
  const cable = page
    .getByTestId('network-inspector')
    .locator('article')
    .filter({ has: page.getByText('Electrical Cable', { exact: true }) });
  await expect(cable).toContainText('Connected');
  await expect(cable).toContainText('Automatic contact: 3, 8');
  await expect(cable).toContainText('any directly adjacent side');
  await cable
    .getByRole('button', { name: 'Disable segment', exact: true })
    .click();
  await expect(page.getByTestId('building-status')).toHaveText(
    'No power connection',
  );
  await cable
    .getByRole('button', { name: 'Enable segment', exact: true })
    .click();
  await expect(cable).toContainText('Connected');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const save = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(save.inventory.energy).toBe(120);
  expect(save.networkRulesVersion).toBe(4);
});
