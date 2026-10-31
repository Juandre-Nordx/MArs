import { describe, expect, it } from 'vitest';
import {
  advance,
  aggregateStores,
  alerts,
  buildInfrastructure,
  colonySchema,
  connectionTiles,
  deployColony,
  distributeCargo,
  infrastructureDefinitions,
  loadSave,
  networkFor,
  newGame,
  port,
  rebuildNetworks,
  refreshNetworks,
  routeBetween,
  routePreview,
  setPowerPriority,
  step,
  toggleSegment,
  type ColonyState,
  type InfrastructureType,
} from '../../packages/simulation/src/index.js';
const active = () => deployColony(newGame());
const house = (s: ColonyState) =>
  s.buildings.find((b) => b.type === 'housing')!;
function cut(s: ColonyState, type: InfrastructureType, buildingId: string) {
  const b = s.buildings.find((b) => b.id === buildingId)!;
  return connectionTiles(b, type)
    .filter((tile) =>
      s.infrastructure.some(
        (segment) =>
          segment.type === type && segment.x === tile.x && segment.y === tile.y,
      ),
    )
    .reduce((state, tile) => buildInfrastructure(state, type, [tile], true), s);
}
function total(s: ColonyState, key: 'water' | 'oxygen' | 'energy') {
  return s.buildings.reduce((sum, b) => sum + b.stores[key], 0);
}
describe('physical starter networks', () => {
  it('connects every starter port to four separate compatible networks', () => {
    const s = active();
    expect(s.networks.map((n) => n.type)).toEqual([
      'water',
      'oxygen',
      'power',
      'road',
    ]);
    for (const b of s.buildings)
      for (const type of ['water', 'oxygen', 'power'] as const)
        if (port(b, type))
          expect(networkFor(s.networks, b.id, type)).toBeDefined();
    expect(s.networks.find((n) => n.type === 'road')?.buildings).toHaveLength(
      19,
    );
    expect(step(s).inventory.water).toBe(99.76);
    expect(step(s).inventory.oxygen).toBe(100.08);
  });
  it('denies water to a cut habitat while preserving its oxygen connection', () => {
    const s = active(),
      h = house(s);
    const disconnected = cut(s, 'water', h.id);
    expect(disconnected.buildings.find((b) => b.id === h.id)?.status).toBe(
      'no-water-connection',
    );
    expect(networkFor(disconnected.networks, h.id, 'water')).toBeUndefined();
    expect(networkFor(disconnected.networks, h.id, 'oxygen')).toBeDefined();
    const next = step(disconnected);
    expect(next.telemetry.unmet.water).toBeGreaterThanOrEqual(0.008);
    expect(alerts(next).some((a) => a.startsWith('No water connection'))).toBe(
      true,
    );
  });
  it('isolates oxygen demand and reports oxygen shortage after disconnection', () => {
    const s = active();
    const next = step(cut(s, 'oxygen', house(s).id));
    expect(next.telemetry.unmet.oxygen).toBeGreaterThanOrEqual(0.01);
    expect(next.buildings.find((b) => b.id === house(s).id)?.status).toBe(
      'no-oxygen-connection',
    );
  });
  it('does not generate electricity for a grid when solar port is cut', () => {
    const s = active();
    const solar = s.buildings.find((b) => b.type === 'solar')!;
    const next = step(cut(s, 'power', solar.id));
    expect(next.telemetry.generated).toBe(0);
    expect(next.inventory.energy).toBeLessThan(s.inventory.energy);
    expect(next.buildings.find((b) => b.id === solar.id)?.status).toBe(
      'no-power-connection',
    );
  });
  it('cannot draw disconnected battery reserves and charges/discharges connected batteries exactly', () => {
    const s = active(),
      battery = s.buildings.find((b) => b.type === 'battery')!;
    const isolated = cut(s, 'power', battery.id);
    isolated.tick = 180;
    const emptyGrid = step(isolated);
    expect(emptyGrid.inventory.energy).toBe(s.inventory.energy);
    expect(emptyGrid.telemetry.used).toBe(0);
    expect(step(s).inventory.energy).toBe(122);
    const night = { ...s, tick: 180 };
    expect(step(night).inventory.energy).toBe(114);
  });
  it('allocates scarce power in saved priority order', () => {
    let s = active();
    s.tick = 180;
    s.inventory.energy = 2;
    distributeCargo(s);
    const oxygen = s.buildings.find((b) => b.type === 'oxygen-generator')!;
    s = setPowerPriority(s, oxygen.id, 0);
    s = setPowerPriority(
      s,
      s.buildings.find((b) => b.type === 'starship')!.id,
      100,
    );
    const next = step(s);
    expect(next.buildings.find((b) => b.id === oxygen.id)?.status).toBe(
      'running',
    );
    expect(next.inventory.energy).toBe(0);
    expect(next.telemetry.used).toBe(2);
  });
});
describe('topology and conservation', () => {
  it('splits and merges a road component without cross-channel connections', () => {
    let s = active();
    s = refreshNetworks({ ...s, infrastructure: [] });
    s = buildInfrastructure(
      s,
      'road',
      routeBetween({ x: 0, y: 2 }, { x: 4, y: 2 }),
    );
    expect(s.networks).toHaveLength(1);
    const split = buildInfrastructure(s, 'road', [{ x: 2, y: 2 }], true);
    expect(split.networks).toHaveLength(2);
    const merged = buildInfrastructure(split, 'road', [{ x: 2, y: 2 }]);
    expect(merged.networks).toHaveLength(1);
    const crossed = buildInfrastructure(merged, 'water', [{ x: 2, y: 2 }]);
    expect(crossed.networks.map((n) => n.type)).toEqual(['water', 'road']);
  });
  it('preserves all physical reserves when connectivity splits/merges and rebuilding is repeated', () => {
    const s = active();
    const tank = s.buildings.find((b) => b.type === 'water-tank')!;
    const tile = port(tank, 'water')!;
    const split = cut(s, 'water', tank.id);
    const merged = buildInfrastructure(split, 'water', [tile]);
    for (const key of ['water', 'oxygen', 'energy'] as const) {
      expect(total(split, key)).toBe(total(s, key));
      expect(total(merged, key)).toBe(total(s, key));
    }
    expect(refreshNetworks(refreshNetworks(merged))).toEqual(
      refreshNetworks(merged),
    );
    expect(s.inventory.metal).toBe(80);
  });
  it('does not teleport reserves from an isolated tank into another water component', () => {
    const s = active();
    const tank = s.buildings.find((b) => b.type === 'water-tank')!;
    const disconnected = cut(s, 'water', tank.id); // Initial water is entirely in this physical tank.
    const next = step(disconnected);
    expect(next.buildings.find((b) => b.id === tank.id)?.stores.water).toBe(
      100,
    );
    expect(next.telemetry.unmet.water).toBeGreaterThan(0);
    expect(next.inventory.water).toBeGreaterThanOrEqual(100);
  });
  for (const type of ['water', 'oxygen'] as const)
    it(`keeps two independent ${type} pools isolated during allocation`, () => {
      let s = refreshNetworks({ ...active(), infrastructure: [] });
      const homes = s.buildings.filter((b) => b.type === 'housing'),
        first = homes[0]!,
        last = homes.at(-1)!;
      const tank = s.buildings.find((b) => b.type === `${type}-tank`)!,
        ship = s.buildings.find((b) => b.type === 'starship')!;
      const tankPort = port(tank, type)!,
        homePort = port(first, type)!,
        otherPort = port(last, type)!,
        shipPort = port(ship, type)!;
      const leftX = first.x - 1,
        rightX = last.x + 2;
      const left = [
        ...routeBetween(tankPort, { x: leftX, y: tankPort.y }),
        ...routeBetween(
          { x: leftX, y: tankPort.y },
          { x: leftX, y: homePort.y },
        ),
        ...routeBetween({ x: leftX, y: homePort.y }, homePort),
      ];
      const right = [
        ...routeBetween(shipPort, { x: rightX, y: shipPort.y }),
        ...routeBetween(
          { x: rightX, y: shipPort.y },
          { x: rightX, y: otherPort.y },
        ),
        ...routeBetween({ x: rightX, y: otherPort.y }, otherPort),
      ];
      s = buildInfrastructure(buildInfrastructure(s, type, left), type, right);
      expect(s.networks.filter((n) => n.type === type)).toHaveLength(2);
      const next = step(s),
        receiving = networkFor(next.networks, first.id, type)!,
        empty = networkFor(next.networks, last.id, type)!;
      expect(receiving.allocated).toBe(type === 'water' ? 0.008 : 0.01);
      expect(empty.allocated).toBe(0);
      expect(empty.status).toBe('shortage');
      expect(next.inventory[type]).toBeCloseTo(100 - receiving.allocated, 6);
    });
  it('accounts material flows once per tick across components and deterministic frame partitions', () => {
    const s = active();
    const next = step(s);
    for (const key of ['water', 'oxygen'] as const)
      expect(next.inventory[key]).toBeCloseTo(
        s.inventory[key] +
          next.telemetry.produced[key] -
          next.telemetry.consumed[key],
        6,
      );
    for (const n of next.networks)
      expect(n.allocated).toBeLessThanOrEqual(n.supply + 1e-6);
    const c = { colony: s, remainderMs: 0 };
    expect(advance(advance(c, 1700), 2300)).toEqual(advance(c, 4000));
    expect(colonySchema.safeParse(next).success).toBe(true);
  });
  it('broken/disabled segments disconnect immediately and can be replaced without refund farming', () => {
    const s = active(),
      h = house(s);
    const tile = port(h, 'power')!;
    const segment = s.infrastructure.find(
      (i) => i.type === 'power' && i.x === tile.x && i.y === tile.y,
    )!;
    const contacts = new Set(
      connectionTiles(h, 'power').map((t) => `power:${t.x},${t.y}`),
    );
    const isolated = refreshNetworks({
      ...s,
      infrastructure: s.infrastructure.filter(
        (i) => i.id === segment.id || !contacts.has(i.id),
      ),
    });
    const off = toggleSegment(isolated, segment.id);
    expect(networkFor(off.networks, h.id, 'power')).toBeUndefined();
    const broken = refreshNetworks({
      ...isolated,
      infrastructure: isolated.infrastructure.map((i) =>
        i.id === segment.id ? { ...i, health: 0 } : i,
      ),
    });
    expect(networkFor(broken.networks, h.id, 'power')).toBeUndefined();
    const fixed = buildInfrastructure(broken, 'power', [tile]);
    expect(networkFor(fixed.networks, h.id, 'power')).toBeDefined();
    expect(fixed.inventory.metal).toBe(79.5);
  });
});
describe('route commands and save compatibility', () => {
  it('previews atomically, rejects invalid routes and charges only unique newly built segments', () => {
    const s = active();
    const route = routeBetween({ x: 0, y: 2 }, { x: 2, y: 2 });
    const original = JSON.stringify(s);
    const preview = routePreview(s, 'water', route);
    expect(preview.valid).toBe(true);
    expect(preview.cost).toBe(0.75);
    expect(JSON.stringify(s)).toBe(original);
    const built = buildInfrastructure(s, 'water', [...route, route[0]!]);
    expect(built.inventory.metal).toBe(79.25);
    expect(buildInfrastructure(built, 'water', route).inventory.metal).toBe(
      79.25,
    );
    expect(() => buildInfrastructure(s, 'road', [s.buildings[0]!])).toThrow();
    expect(() => buildInfrastructure(s, 'power', [{ x: -1, y: 0 }])).toThrow();
    expect(() =>
      buildInfrastructure(s, 'road', [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
      ]),
    ).toThrow();
    expect(() =>
      buildInfrastructure(
        { ...s, inventory: { ...s.inventory, metal: 0 } },
        'power',
        route,
      ),
    ).toThrow();
    expect(JSON.stringify(s)).toBe(original);
  });
  it('refunds only paid construction at configured rates, with no refund for mission infrastructure', () => {
    const s = active();
    const route = [{ x: 0, y: 2 }];
    const built = buildInfrastructure(s, 'road', route);
    const removed = buildInfrastructure(built, 'road', route, true);
    expect(removed.inventory.metal).toBe(
      80 -
        infrastructureDefinitions.road.metal *
          (1 - infrastructureDefinitions.road.refund),
    );
    const free = s.infrastructure.find((i) => i.type === 'road')!;
    expect(buildInfrastructure(s, 'road', [free], true).inventory.metal).toBe(
      80,
    );
  });
  it('persists segments, disabled/damaged state, priorities and stores and rebuilds topology safely', () => {
    let s = active();
    const water = s.infrastructure.find((i) => i.type === 'water')!;
    s = toggleSegment(s, water.id);
    s = setPowerPriority(s, house(s).id, 5);
    s = refreshNetworks({
      ...s,
      infrastructure: s.infrastructure.map((i) =>
        i.type === 'road' ? { ...i, health: 25 } : i,
      ),
    });
    const loaded = loadSave(JSON.parse(JSON.stringify(s)));
    expect(loaded.infrastructure).toEqual(s.infrastructure);
    expect(loaded.buildings).toEqual(s.buildings);
    expect(loaded.inventory).toEqual(s.inventory);
    expect(loaded.networks).toEqual(rebuildNetworks(loaded));
    expect(loadSave({ ...s, networks: [] }).networks).toEqual(
      rebuildNetworks(s),
    );
    const invalid = JSON.parse(JSON.stringify(s));
    invalid.inventory.water++;
    expect(() => loadSave(invalid)).toThrow();
  });
  it('migrates version 2 exactly once, preserving every building ID and resource', () => {
    const current = active();
    const {
      world: _world,
      residents: _residents,
      nextResidentId: _nextResidentId,
      immigration: _immigration,
      infrastructure: _i,
      networks: _n,
      networkRulesVersion: _r,
      ...legacy
    } = current;
    void _world;
    void _residents;
    void _nextResidentId;
    void _immigration;
    void _i;
    void _n;
    void _r;
    const old = {
      ...legacy,
      schemaVersion: 2,
      buildings: legacy.buildings.map(({ stores: _s, priority: _p, ...b }) => {
        void _s;
        void _p;
        return b;
      }),
    };
    const migrated = loadSave(old);
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.inventory).toEqual(old.inventory);
    expect(migrated.buildings.map((b) => b.id)).toEqual(
      old.buildings.map((b) => b.id),
    );
    expect(migrated.infrastructure.length).toBeGreaterThan(0);
    expect(loadSave(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    const copy = { ...migrated, inventory: { ...migrated.inventory } };
    aggregateStores(copy);
    expect(copy.inventory).toEqual(migrated.inventory);
  });
});
