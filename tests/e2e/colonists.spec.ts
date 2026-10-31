import { expect, test } from '@playwright/test';
import {
  buildInfrastructure,
  construct,
  deployColony,
  networkFor,
  newGame,
  port,
  step,
  walkingPath,
} from '../../packages/simulation/src/index.js';
function incoming() {
  let s = construct(deployColony(newGame()), 'housing', { x: 2, y: 9 });
  const home = s.buildings.at(-1)!;
  for (const type of ['water', 'oxygen', 'power'] as const) {
    const network = networkFor(s.networks, 'starter-0', type)!,
      segment = s.infrastructure.find((i) => i.id === network.segments[0])!,
      endpoint = port(home, type)!,
      path = walkingPath(s, endpoint, segment);
    if (!path) throw new Error('No route');
    s = buildInfrastructure(s, type, [endpoint, ...path]);
  }
  for (let i = 0; i < 30; i++) s = step(s);
  return s;
}
test('visible colonists walk, freeze with pause and retain identities/routes in a browser save', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'Skip landing' }).click();
  await page.getByRole('button', { name: '4×', exact: true }).click();
  await expect(page.getByTestId('walking-count')).not.toHaveText('0 walking');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(200);
  const before = await page.locator('canvas').screenshot();
  await page.waitForTimeout(400);
  expect((await page.locator('canvas').screenshot()).equals(before)).toBe(true);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const snapshot = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(snapshot.residents).toHaveLength(10);
  expect(snapshot.residents.some((r: { trips: number }) => r.trips > 0)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByTestId('resident-summary')).toContainText(
    '10 residents',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(restored.residents).toEqual(snapshot.residents);
  expect(errors).toEqual([]);
});
test('a saved incoming buggy delivers one new resident and charges the increased population', async ({
  page,
}) => {
  const state = incoming();
  expect(state.immigration.convoy?.phase).toBe('arriving');
  state.speed = 0;
  await page.goto('/');
  await page.evaluate(
    (save) =>
      localStorage.setItem('mars-first-colony-save', JSON.stringify(save)),
    state,
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByTestId('arrival-status')).toHaveText(
    'Buggy arriving with one newcomer',
  );
  const before = await page.locator('canvas').screenshot();
  await page.getByRole('button', { name: '4×', exact: true }).click();
  await expect(page.getByTestId('resident-summary')).toContainText(
    '11 residents',
    { timeout: 15000 },
  );
  await expect(page.getByTestId('arrival-status')).toHaveText(
    'Buggy returning to the outpost',
  );
  expect((await page.locator('canvas').screenshot()).equals(before)).toBe(
    false,
  );
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
  expect(saved.residents).toHaveLength(11);
  expect(new Set(saved.residents.map((r: { id: string }) => r.id)).size).toBe(
    11,
  );
  expect(saved.telemetry.consumed.food).toBeCloseTo(0.033);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByTestId('resident-summary')).toContainText(
    '11 residents',
  );
});
