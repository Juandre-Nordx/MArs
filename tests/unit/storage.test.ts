import { legacyGame as newGame } from '../helpers/landing.js';
import { expect, it } from 'vitest';
import {
  construct,
  deployColony,
  storageOverview,
  toggleBuilding,
} from '../../packages/simulation/src/index.js';
it('reports shared cargo once, physical utilities by actual owner, and separate drone batteries', () => {
  let s = construct(deployColony(newGame()), 'survey-station', { x: 8, y: 3 });
  s.industry.drones[0]!.battery = 10;
  const tank = s.buildings.find((b) => b.type === 'water-tank')!;
  s = toggleBuilding(s, tank.id);
  const overview = storageOverview(s);
  for (const resource of ['energy', 'water', 'oxygen'] as const) {
    const actual = overview.utilityStores
      .filter((p) => p.resource === resource)
      .reduce((n, p) => n + p.quantity, 0);
    expect(actual).toBe(s.inventory[resource]);
    expect(
      overview.resources.find((r) => r.resource === resource)!.quantity,
    ).toBe(actual);
  }
  expect(overview.resources.find((r) => r.resource === 'metal')).toMatchObject({
    quantity: 140,
    scope: 'shared',
  });
  expect(
    overview.utilityStores.find((p) => p.buildingId === tank.id),
  ).toMatchObject({ enabled: false, quantity: tank.stores.water });
  expect(overview.droneBatteries[0]!.quantity).toBe(10);
  expect(
    overview.resources.find((r) => r.resource === 'energy')!.quantity,
  ).toBe(s.inventory.energy);
  expect(overview.mines).toHaveLength(0);
});
it('uses actual capacity and low/full stock warnings without inventing cargo ownership', () => {
  const s = deployColony(newGame());
  s.inventory.food = 0;
  s.inventory.metal = 400;
  const overview = storageOverview(s);
  expect(overview.resources.find((r) => r.resource === 'food')!.warning).toBe(
    'Low stock',
  );
  expect(overview.resources.find((r) => r.resource === 'metal')).toMatchObject({
    capacity: 400,
    quantity: 400,
    warning: 'Full',
    scope: 'shared',
  });
  expect(
    overview.utilityStores.every(
      (s) => !(['metal', 'food'] as string[]).includes(s.resource),
    ),
  ).toBe(true);
});
