import { expect, it } from 'vitest';
import {
  buildInfrastructure,
  colonySchema,
  construct,
  deployColony,
  discoveredDeposits,
  findLandingZone,
  footprint,
  generateDeposits,
  isExplored,
  loadSave,
  networkFor,
  newGame,
  requestScan,
  step,
  walkingPath,
} from '../../packages/simulation/src/index.js';
const run = (s: ReturnType<typeof newGame>, ticks: number) => {
  for (let i = 0; i < ticks; i++) s = step(s);
  return s;
};
it('lands new colonies at the map centre with explored, accessible starter buildings', () => {
  for (const seed of [0, 1, 37, 2147483647]) {
    const s = deployColony(newGame(seed));
    expect(s.landingZone).toEqual({ x: 256, y: 256 });
    expect(s.world.generatorVersion).toBe(2);
    const original = generateDeposits(seed, 1, 1);
    const central = generateDeposits(seed, 16, 16, 2);
    expect(
      central.map(({ id: _id, x: _x, y: _y, ...deposit }) => {
        void _id;
        void _x;
        void _y;
        return deposit;
      }),
    ).toEqual(
      original.map(({ id: _id, x: _x, y: _y, ...deposit }) => {
        void _id;
        void _x;
        void _y;
        return deposit;
      }),
    );
    expect(s.buildings).toHaveLength(19);
    expect(
      s.buildings
        .flatMap((b) => footprint(b.type, b))
        .every((t) => isExplored(s.world, t)),
    ).toBe(true);
    expect(
      Object.values(s.world.chunks).reduce((n, c) => n + c.explored.length, 0),
    ).toBe(400);
    expect(isExplored(s.world, { x: 0, y: 0 })).toBe(false);
    expect(colonySchema.safeParse(s).success).toBe(true);
    expect(loadSave(JSON.parse(JSON.stringify(s))).buildings).toEqual(
      s.buildings,
    );
  }
});
it('keeps old saved colonies and schema-1 migration at their original landing location', () => {
  const old = deployColony(newGame(1, 'legacy'));
  const loaded = loadSave(JSON.parse(JSON.stringify(old)));
  expect(loaded.landingZone).toEqual(findLandingZone(1, 'legacy'));
  expect(loaded.world).toEqual(old.world);
  expect(loaded.buildings).toEqual(old.buildings);
  expect(loaded.residents).toEqual(old.residents);
  expect(
    loadSave({
      schemaVersion: 1,
      seed: 1,
      tick: 0,
      name: 'Legacy',
      inventory: { water: 30, oxygen: 30, metal: 20 },
    }).landingZone,
  ).toEqual(old.landingZone);
});
it('provides nearby deposits and functional surveying/mining for the central colony', () => {
  let s = construct(deployColony(newGame()), 'survey-station', {
    x: 255,
    y: 251,
  });
  s.industry.drones[0]!.battery = 128;
  s.industry.drones[1]!.battery = 64;
  s = requestScan(
    s,
    'built-1',
    'subsurface',
    { x: 261, y: 264 },
    { x: 267, y: 264 },
    true,
  );
  s = run(s, 60);
  const deposits = discoveredDeposits(s.world);
  expect(deposits).toHaveLength(7);
  expect(deposits.some((d) => d.resource === 'ice')).toBe(true);
  expect(
    deposits.every((d) => Math.abs(d.x - 256) < 16 && Math.abs(d.y - 256) < 16),
  ).toBe(true);
  const iron = deposits.find((d) => d.resource === 'iron')!,
    initial = iron.remainingQuantity;
  s = construct(s, 'surface-mine', { x: iron.x, y: iron.y });
  const endpoint = { x: iron.x, y: iron.y - 1 },
    network = networkFor(s.networks, 'starter-0', 'power')!;
  const segment = s.infrastructure.find((i) => i.id === network.segments[0])!;
  const path = walkingPath(s, endpoint, segment);
  expect(path).not.toBeNull();
  s = buildInfrastructure(s, 'power', [endpoint, ...path!]);
  s = run(s, 90);
  const quantity = s.industry.mines[0]!.quantity;
  expect(quantity).toBeGreaterThan(0);
  expect(
    discoveredDeposits(s.world).find((d) => d.id === iron.id)!
      .remainingQuantity + quantity,
  ).toBeCloseTo(initial, 6);
});
it('brings newcomers from the local central staging perimeter instead of the old map corner', () => {
  let s = construct(deployColony(newGame()), 'housing', { x: 249, y: 257 });
  const home = s.buildings.at(-1)!;
  for (const type of ['water', 'oxygen', 'power'] as const) {
    const endpoint = { x: home.x, y: home.y - 1 },
      network = networkFor(s.networks, 'starter-0', type)!;
    const segment = s.infrastructure.find((i) => i.id === network.segments[0])!;
    const path = walkingPath(s, endpoint, segment)!;
    s = buildInfrastructure(s, type, [endpoint, ...path]);
  }
  s = run(s, 30);
  expect(s.immigration.convoy).not.toBeNull();
  const exit = s.immigration.convoy!.exit;
  expect(exit.x).toBeGreaterThanOrEqual(247);
  expect(exit.y).toBeGreaterThanOrEqual(247);
  expect(exit.x).toBeLessThanOrEqual(266);
  expect(exit.y).toBeLessThanOrEqual(266);
  expect(s.immigration.convoy!.route.length).toBeLessThan(60);
  expect(run(s, 60).population).toBe(11);
});
