import { charged } from '../helpers/industry.js';
import { expect, it } from 'vitest';
import {
  capacities,
  deployColony,
  generateDeposits,
  discoveredDeposits,
  hash,
  landingCargo,
  loadSave,
  newGame,
  newWorld,
  resourceKeys,
  requestScan,
  step,
  scanTile,
  type Stock,
} from '../../packages/simulation/src/index.js';
const originalCargo: Stock = {
  water: 100,
  oxygen: 100,
  food: 60,
  energy: 120,
  metal: 80,
  wastewater: 60,
  carbonDioxide: 40,
  nutrients: 80,
};
it('doubles every starting resource and retains the full shipment after deployment and reload', () => {
  const s = deployColony(newGame());
  for (const key of resourceKeys) {
    expect(landingCargo[key]).toBe(originalCargo[key] * 2);
    expect(s.inventory[key]).toBe(originalCargo[key] * 2);
    expect(capacities(s)[key]).toBeGreaterThanOrEqual(s.inventory[key]);
  }
  expect(loadSave(JSON.parse(JSON.stringify(s))).inventory).toEqual(
    s.inventory,
  );
});
it('doubles seed-defined reserves without changing locations, mineral types or richness', () => {
  for (const seed of [0, 1, 37, 2147483647])
    for (const [cx, cy] of [
      [0, 0],
      [1, 1],
      [10, 20],
    ]) {
      for (const [i, d] of generateDeposits(seed, cx!, cy!).entries()) {
        const h = hash(seed + 991 + i, cx!, cy!);
        expect(d.initialQuantity).toBe(2 * (1000 + (h % 4001)));
        expect(d.remainingQuantity).toBe(d.initialQuantity);
        expect(d.richness).toBe((4 + (h % 7)) / 10);
      }
    }
});
it('preserves saved cargo and depleted old deposit quantities rather than granting resources on load or scan', () => {
  let s = deployColony(newGame());
  s.inventory = { ...originalCargo };
  // Redistribute the explicit saved physical reserves without changing the saved aggregate.
  for (const key of ['water', 'oxygen', 'energy'] as const) {
    let left = originalCargo[key];
    for (const b of s.buildings) {
      const amount = Math.min(b.stores[key], left);
      b.stores[key] = amount;
      left -= amount;
    }
  }
  s.world = scanTile(s.world, s.seed, { x: 261, y: 264 }, 'surface');
  const d = s.world.chunks['16,16']!.deposits[0]!;
  d.initialQuantity /= 2;
  d.remainingQuantity = 0;
  s = loadSave(JSON.parse(JSON.stringify(s)));
  expect(s.inventory).toEqual(originalCargo);
  const scanned = scanTile(s.world, s.seed, { x: 261, y: 264 }, 'deep');
  expect(scanned.chunks['16,16']!.deposits[0]).toEqual(d);
});
it('finds every buried starter feedstock with a subsurface scan across varied seeds', () => {
  for (const seed of [0, 1, 37, 2147483647]) {
    let world = newWorld(seed);
    const seeded = generateDeposits(seed, 1, 1);
    for (const deposit of seeded)
      world = scanTile(
        world,
        seed,
        { x: deposit.x, y: deposit.y },
        'subsurface',
      );
    expect(discoveredDeposits(world)).toHaveLength(seeded.length);
    expect(
      discoveredDeposits(world).some((d) => d.resource === 'lithium'),
    ).toBe(true);
    expect(discoveredDeposits(world).some((d) => d.resource === 'ice')).toBe(
      true,
    );
  }
});

it('loads in-progress surveys from the slower scan settings without granting instant discoveries', () => {
  for (const [mode, progress] of [
    ['subsurface', 1],
    ['deep', 2],
    ['deep', 3],
  ] as const) {
    const tile = { x: 21, y: 24 };
    const old = requestScan(charged(), 'built-1', mode, tile, tile);
    old.industry.scans[0]!.status = 'active';
    old.industry.scans[0]!.progress = progress;
    const drone = old.industry.drones[0]!;
    drone.job = { type: 'scan', id: old.industry.scans[0]!.id };
    drone.position = tile;
    drone.activity = 'working';
    const { production: _production, ...legacy } = old;
    void _production;
    const loaded = loadSave(
      JSON.parse(JSON.stringify({ ...legacy, schemaVersion: 6 })),
    );
    expect(loaded.inventory).toEqual(old.inventory);
    expect(loaded.world).toEqual(old.world);
    expect(loaded.industry.drones).toEqual(old.industry.drones);
    expect(discoveredDeposits(loaded.world)).toHaveLength(0);
    expect(discoveredDeposits(step(loaded).world)).toHaveLength(1);
    old.industry.scans[0]!.progress = 4;
    expect(() => loadSave(old)).toThrow();
  }
});
