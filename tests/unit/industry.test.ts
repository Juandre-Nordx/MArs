import { legacyGame as newGame } from '../helpers/landing.js';
import { describe, expect, it } from 'vitest';
import {
  colonySchema,
  distributeCargo,
  construct,
  deployColony,
  discoveredDeposits,
  loadSave,
  placement,
  requestScan,
  revealArea,
  scanTile,
  step,
  toggleBuilding,
} from '../../packages/simulation/src/index.js';
import { station, charged, mine, run } from '../helpers/industry.js';
describe('survey drones and saves', () => {
  it('constructs paid stations with empty batteries and charges using real grid energy', () => {
    const base = deployColony(newGame()),
      s = station();
    expect(s.inventory.metal).toBe(base.inventory.metal - 20);
    expect(s.credits).toBe(base.credits - 10);
    expect(s.industry.drones.every((d) => d.battery === 0)).toBe(true);
    s.inventory.energy = 120;
    distributeCargo(s);
    const next = step(s);
    const chargedEnergy = next.industry.drones.reduce(
      (n, d) => n + d.battery,
      0,
    );
    expect(chargedEnergy).toBe(6);
    expect(next.telemetry.used - step(base).telemetry.used).toBeCloseTo(6.25);
    expect(next.inventory.energy - s.inventory.energy).toBeCloseTo(
      next.telemetry.generated - next.telemetry.used,
    );
    const off = step(toggleBuilding(s, 'built-1'));
    expect(off.industry.drones.every((d) => d.battery === 0)).toBe(true);
    expect(s.industry.drones.every((d) => d.battery === 0)).toBe(true);
  });
  it('travels, scans over fixed ticks, queues exclusively and optionally maps terrain', () => {
    let s = charged();
    const tile = { x: 21, y: 24 };
    s = requestScan(s, 'built-1', 'surface', tile, tile, true);
    s = requestScan(s, 'built-1', 'deep', tile, tile);
    const first = step(s);
    expect(discoveredDeposits(first.world)).toHaveLength(0);
    expect(first.industry.drones[0]!.position).not.toEqual(
      s.industry.drones[0]!.position,
    );
    expect(first.industry.scans.map((q) => q.status)).toEqual([
      'active',
      'queued',
    ]);
    const done = run(first, 170);
    expect(done.industry.scans.every((q) => q.status === 'complete')).toBe(
      true,
    );
    expect(discoveredDeposits(done.world)).toHaveLength(1);
    expect(done.world.chunks['1,1']!.explored).toContain(8 * 16 + 5);
    const resumed = loadSave(JSON.parse(JSON.stringify(done)));
    expect(resumed.industry).toEqual(done.industry);
    expect(step(resumed)).toEqual(step(done));
    expect(run(charged(), 3).world).toEqual(charged().world);
  });
  it('rejects invalid regions, invalid jobs and duplicate exclusive assignments', () => {
    const s = charged();
    expect(() =>
      requestScan(s, 'built-1', 'surface', { x: 0, y: 0 }, { x: 16, y: 0 }),
    ).toThrow();
    expect(() =>
      requestScan(s, 'built-1', 'deep', { x: 90, y: 90 }, { x: 90, y: 90 }),
    ).toThrow();
    const queued = requestScan(
      s,
      'built-1',
      'deep',
      { x: 21, y: 24 },
      { x: 21, y: 24 },
    );
    const active = step(queued);
    const invalid = structuredClone(active);
    invalid.industry.drones[1]!.job = invalid.industry.drones[0]!.job;
    expect(() => loadSave(invalid)).toThrow();
    expect(() =>
      loadSave({ ...active, industry: { ...active.industry, drones: [] } }),
    ).toThrow();
  });
  it('migrates schema 5 without changing discoveries, reserves, or colony entities', () => {
    const s = deployColony(newGame());
    s.world = scanTile(s.world, s.seed, { x: 21, y: 24 }, 'deep');
    s.world.chunks['1,1']!.deposits[0]!.remainingQuantity = 0;
    const { production: _production, industry: _industry, ...old } = s;
    void _production;
    void _industry;
    const next = loadSave({ ...old, schemaVersion: 5 });
    expect(next.world).toEqual(s.world);
    expect(next.inventory).toEqual(s.inventory);
    expect(next.buildings).toEqual(s.buildings);
    expect(next.residents).toEqual(s.residents);
    expect(next.industry).toEqual({
      nextScanId: 1,
      scans: [],
      drones: [],
      mines: [],
    });
    const loaded = loadSave(JSON.parse(JSON.stringify(next)));
    expect(loaded.industry).toEqual(next.industry);
    expect(loaded.world).toEqual(next.world);
    expect(step(loaded)).toEqual(step(next));
  });
});
describe('finite mining', () => {
  it('requires explored, discovered compatible deposits and paid construction', () => {
    const s = charged(),
      tile = { x: 21, y: 24 };
    expect(placement(s, 'surface-mine', tile).valid).toBe(false);
    s.world = revealArea(s.world, s.seed, tile, tile);
    expect(placement(s, 'surface-mine', tile).reason).toContain('discovered');
    s.world = scanTile(s.world, s.seed, tile, 'deep');
    expect(placement(s, 'underground-mine', tile).valid).toBe(false);
    const built = construct(s, 'surface-mine', tile);
    expect(built.inventory.metal).toBe(s.inventory.metal - 12);
    expect(built.industry.mines[0]!.quantity).toBe(0);
    expect(placement({ ...s, credits: 0 }, 'surface-mine', tile).valid).toBe(
      false,
    );
  });
  it('travels before extracting and conserves finite ore in local buffers only', () => {
    const s = mine(),
      initial = discoveredDeposits(s.world)[0]!.remainingQuantity;
    const first = step(s);
    expect(first.industry.mines[0]!.quantity).toBe(0);
    const next = run(first, 120),
      quantity = next.industry.mines[0]!.quantity;
    expect(quantity).toBeGreaterThan(0);
    expect(quantity).toBeLessThanOrEqual(40);
    expect(
      discoveredDeposits(next.world)[0]!.remainingQuantity + quantity,
    ).toBeCloseTo(initial, 6);
    expect(next.inventory.metal).toBe(s.inventory.metal);
    expect(next.inventory.water).toBeLessThan(s.inventory.water);
    expect(colonySchema.safeParse(next).success).toBe(true);
    const loaded = loadSave(JSON.parse(JSON.stringify(next)));
    expect(loaded.industry).toEqual(next.industry);
    expect(loaded.world).toEqual(next.world);
    expect(step(loaded)).toEqual(step(next));
    expect(s.industry.mines[0]!.quantity).toBe(0);
    expect(discoveredDeposits(s.world)[0]!.remainingQuantity).toBe(initial);
  });
  it('stops exactly at depletion, and rescanning/reloading cannot replenish ore', () => {
    let s = mine();
    s.world.chunks['1,1']!.deposits[0]!.remainingQuantity = 0.3;
    s = run(s, 120);
    expect(s.industry.mines[0]!.quantity).toBe(0.3);
    expect(discoveredDeposits(s.world)[0]!.remainingQuantity).toBe(0);
    s.world = scanTile(s.world, s.seed, { x: 21, y: 24 }, 'deep');
    s = run(loadSave(JSON.parse(JSON.stringify(s))), 20);
    expect(s.industry.mines[0]!.quantity).toBe(0.3);
    expect(s.buildings.find((b) => b.type === 'surface-mine')!.status).toBe(
      'depleted',
    );
  });
  it('stops for full buffers, unavailable drones and disabled or unpowered mines', () => {
    let s = mine();
    const b = s.buildings.find((b) => b.type === 'surface-mine')!;
    const noDrone = structuredClone(s);
    noDrone.industry.drones[1]!.battery = 0;
    const station = noDrone.buildings.find((b) => b.type === 'survey-station')!;
    station.enabled = false;
    expect(run(noDrone, 10).industry.mines[0]!.quantity).toBe(0);
    expect(run(toggleBuilding(s, b.id), 100).industry.mines[0]!.quantity).toBe(
      0,
    );
    const noPower = structuredClone(s);
    noPower.buildings
      .filter((b) => b.type === 'solar')
      .forEach((b) => (b.enabled = false));
    noPower.buildings.forEach((b) => (b.stores.energy = 0));
    noPower.inventory.energy = 0;
    expect(run(noPower, 100).industry.mines[0]!.quantity).toBe(0);
    s = run(s, 500);
    expect(s.industry.mines[0]!.quantity).toBe(40);
    const again = run(s, 50);
    expect(again.industry.mines[0]!.quantity).toBe(40);
    expect(
      again.buildings.find((candidate) => candidate.id === b.id)!.status,
    ).toBe('storage-full');
  });
});

it('recovers a blocked ground route and never extracts remotely', () => {
  let s = mine();
  // Let the extractor leave the colony, then surround its current ground position.
  for (let i = 0; i < 80; i++) {
    const d = s.industry.drones[1]!;
    if (d.position.x >= 18 && d.position.y >= 18) break;
    s = step(s);
  }
  const d = s.industry.drones[1]!;
  expect(d.job?.type).toBe('mine');
  const template = s.buildings.find((b) => b.type === 'housing')!;
  const blockers = [
    { x: d.position.x - 1, y: d.position.y },
    { x: d.position.x + 1, y: d.position.y },
    { x: d.position.x, y: d.position.y - 1 },
    { x: d.position.x, y: d.position.y + 1 },
  ].map((p, i) => ({ ...structuredClone(template), ...p, id: `block-${i}` }));
  s = { ...s, buildings: [...s.buildings, ...blockers] };
  const before = s.industry.mines[0]!.quantity;
  s = run(s, 3);
  expect(s.industry.drones[1]!.activity).toBe('blocked');
  expect(s.industry.mines[0]!.quantity).toBe(before);
  s = {
    ...s,
    buildings: s.buildings.filter((b) => !b.id.startsWith('block-')),
  };
  s = run(s, 80);
  expect(s.industry.mines[0]!.quantity).toBeGreaterThan(before);
});
it('keeps active scan and mine progress deterministic through reload and pause', () => {
  let s = requestScan(
    mine(),
    'built-1',
    'deep',
    { x: 21, y: 24 },
    { x: 22, y: 24 },
  );
  s = run(s, 20);
  const resumed = loadSave(JSON.parse(JSON.stringify(s)));
  expect(resumed.industry).toEqual(s.industry);
  expect(run(resumed, 90)).toEqual(run(s, 90));
  const paused = { ...s, speed: 0 as const };
  expect(step(paused)).toBe(paused);
});

it('matches every extraction technology to seed-defined discovered deposits', async () => {
  const { generateDeposits, extractionDefinitions, isMine } = await import(
    '../../packages/simulation/src/index.js'
  );
  const s = deployColony(newGame());
  const deposits = Array.from({ length: 29 * 29 }, (_, i) =>
    generateDeposits(1, 3 + (i % 29), 3 + Math.floor(i / 29)),
  ).flat();
  for (const [type, settings] of Object.entries(extractionDefinitions)) {
    if (
      !isMine(
        type as import('../../packages/simulation/src/index.js').BuildingType,
      )
    )
      continue;
    const d = deposits.find((d) => d.technology === settings.technology)!;
    expect(d).toBeDefined();
    const tile = { x: d.x, y: d.y };
    const found = {
      ...s,
      world: revealArea(
        scanTile(s.world, s.seed, tile, 'deep'),
        s.seed,
        tile,
        tile,
      ),
    };
    expect(
      placement(
        found,
        type as import('../../packages/simulation/src/index.js').BuildingType,
        tile,
      ).valid,
    ).toBe(true);
    const incompatible = type === 'surface-mine' ? 'deep-mine' : 'surface-mine';
    expect(placement(found, incompatible, tile).valid).toBe(false);
  }
});

it('holds survey progress without station power and resumes the same job after recovery', () => {
  let s = requestScan(
    charged(),
    'built-1',
    'deep',
    { x: 21, y: 24 },
    { x: 21, y: 24 },
  );
  s = run(s, 8);
  const stopped = toggleBuilding(s, 'built-1');
  const held = run(stopped, 20);
  expect(held.industry.scans).toEqual(stopped.industry.scans);
  expect(held.industry.drones[0]!.position).toEqual(
    stopped.industry.drones[0]!.position,
  );
  const resumed = run(toggleBuilding(held, 'built-1'), 80);
  expect(resumed.industry.scans[0]!.status).toBe('complete');
  expect(discoveredDeposits(resumed.world)).toHaveLength(1);
});

it('finishes a full deep-survey region across multiple real charging trips without reserve changes', () => {
  let s = requestScan(
    charged(),
    'built-1',
    'deep',
    { x: 16, y: 16 },
    { x: 31, y: 31 },
    true,
  );
  let returns = 0,
    previous = '';
  for (let i = 0; i < 3000 && s.industry.scans[0]!.status !== 'complete'; i++) {
    s = step(s);
    const activity = s.industry.drones[0]!.activity;
    if (activity === 'returning' && previous !== activity) returns++;
    previous = activity;
  }
  expect(returns).toBeGreaterThan(1);
  expect(s.industry.scans[0]).toMatchObject({
    cursor: 256,
    status: 'complete',
  });
  expect(discoveredDeposits(s.world)).toHaveLength(7);
  expect(
    discoveredDeposits(s.world).every(
      (d) => d.remainingQuantity === d.initialQuantity,
    ),
  ).toBe(true);
  expect(colonySchema.safeParse(s).success).toBe(true);
});
