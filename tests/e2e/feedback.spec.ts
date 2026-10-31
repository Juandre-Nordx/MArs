import { expect, test, type Page } from '@playwright/test';
import {
  buildInfrastructure,
  connectionTiles,
  deployColony,
  findLandingZone,
  networkFor,
  newGame,
  refreshNetworks,
  reserve,
  walkingPath,
  port,
  type ColonyState,
  type Tile,
} from '../../packages/simulation/src/index.js';
import { tileToWorld } from '../../apps/web/src/iso.js';
function fixture() {
  const s = deployColony(newGame());
  s.speed = 0;
  const person = s.residents[0]!;
  person.position = { x: 2, y: 8 };
  person.previousPosition = { ...person.position };
  person.route = [];
  person.destinationId = null;
  person.activity = 'resting';
  return s;
}
async function load(page: Page, s: ColonyState) {
  await page.goto('/');
  await page.evaluate(
    (state) =>
      localStorage.setItem('mars-first-colony-save', JSON.stringify(state)),
    s,
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
}
async function point(page: Page, tile: Tile, zoom = 1, dy = 0) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('No canvas');
  const zone = findLandingZone(1),
    c = tileToWorld(zone.x, zone.y),
    p = tileToWorld(tile.x, tile.y);
  return {
    x: box.x + box.width / 2 + (p.x - c.x) * zoom,
    y: box.y + box.height / 2 + (p.y - c.y + dy) * zoom,
  };
}
test('click a colonist for grounded happiness/advice; picking works after zoom and dragging does not talk', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const s = fixture();
  await load(page, s);
  let p = await point(page, s.residents[0]!.position, 1, -15);
  await page.mouse.click(p.x, p.y);
  await expect(
    page
      .getByTestId('colonist-inspector')
      .getByRole('heading', { name: 'Colonist 1', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('citizen-mood')).toHaveText('Content');
  await expect(page.getByTestId('citizen-likes')).toContainText(
    'Reliable water',
  );
  await expect(page.getByTestId('citizen-city-needs')).toContainText(
    'another supplied home',
  );
  await page
    .getByRole('button', { name: 'Close conversation', exact: true })
    .click();
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('No canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(100);
  p = await point(page, s.residents[0]!.position, Math.exp(0.2), -15);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('citizen-mood')).toHaveText('Content');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('colonist-inspector')).toHaveCount(0);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 60, p.y + 30, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('colonist-inspector')).toHaveCount(0);
  await page.mouse.click(p.x + 60, p.y + 30);
  await expect(page.getByTestId('colonist-inspector')).toBeVisible();
  expect(errors).toEqual([]);
});
test('citizen complaints update live when a side-adjacent water pipe reconnects the home', async ({
  page,
}) => {
  let s = fixture();
  const home = s.buildings.find((b) => b.id === s.residents[0]!.homeId)!,
    contacts = connectionTiles(home, 'water');
  s = refreshNetworks({
    ...s,
    infrastructure: s.infrastructure.filter(
      (i) =>
        i.type !== 'water' || !contacts.some((t) => t.x === i.x && t.y === i.y),
    ),
  });
  const repair = contacts.find((tile) => {
    if (s.buildings.some((b) => b.x === tile.x && b.y === tile.y)) return false;
    try {
      const next = buildInfrastructure(s, 'water', [tile]),
        n = networkFor(next.networks, home.id, 'water');
      return n && reserve(next, n) > 0;
    } catch {
      return false;
    }
  });
  if (!repair) throw new Error('No repair contact');
  await load(page, s);
  const p = await point(page, s.residents[0]!.position, 1, -15);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('citizen-mood')).toHaveText('Distressed');
  await expect(page.getByTestId('citizen-concerns')).toContainText(
    'No water connection',
  );
  await expect(page.getByTestId('citizen-likes')).not.toContainText(
    'Reliable water',
  );
  await page
    .getByRole('button', { name: 'Infrastructure', exact: true })
    .click();
  await page.getByRole('button', { name: /^Water Pipe / }).click();
  const target = await point(page, repair);
  await page.mouse.click(target.x, target.y);
  await page.getByRole('button', { name: 'Confirm route' }).click();
  await expect(page.getByTestId('citizen-mood')).toHaveText('Content');
  await expect(page.getByTestId('citizen-likes')).toContainText(
    'Reliable water',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(saved.inventory.water).toBe(s.inventory.water);
  expect(saved.networkRulesVersion).toBe(2);
  await page.getByText('Resident roster', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Talk to Colonist 1', exact: true })
    .click();
  await expect(page.getByTestId('citizen-mood')).toHaveText('Content');
});

test('a click keeps its citizen target when the person walks before mouse release', async ({
  page,
}) => {
  const s = fixture();
  s.speed = 1;
  const resident = s.residents[0]!,
    destination = s.buildings.find((b) => b.type === 'starship')!;
  resident.waitTicks = 0;
  resident.destinationId = destination.id;
  resident.route = walkingPath(
    s,
    resident.position,
    port(destination, 'road')!,
  )!;
  resident.activity = 'walking';
  await load(page, s);
  const p = await point(page, resident.position, 1, -15);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(1300);
  await page.mouse.up();
  await expect(
    page
      .getByTestId('colonist-inspector')
      .getByRole('heading', { name: 'Colonist 1', exact: true }),
  ).toBeVisible();
});
