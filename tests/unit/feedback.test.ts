import { describe, expect, it } from 'vitest';
import {
  buildInfrastructure,
  construct,
  connectionTiles,
  deployColony,
  distributeCargo,
  loadSave,
  networkFor,
  newGame,
  refreshNetworks,
  residentFeedback,
  type ColonyState,
} from '../../packages/simulation/src/index.js';
const active = () => deployColony(newGame());
const noWater = (s: ColonyState) =>
  refreshNetworks({
    ...s,
    infrastructure: s.infrastructure.filter((i) => i.type !== 'water'),
  });
describe('colonist conversations', () => {
  it('reports current positives separately from city growth advice without changing simulation', () => {
    const s = active(),
      before = JSON.stringify(s),
      f = residentFeedback(s, 'colonist-1')!;
    expect(f.mood).toBe('Content');
    expect(f.happyAbout.map((i) => i.code)).toEqual(
      expect.arrayContaining(['home', 'water', 'oxygen', 'food', 'power']),
    );
    expect(f.cityNeeds.some((i) => i.code === 'city-housing-growth')).toBe(
      true,
    );
    expect(f.concerns).toHaveLength(0);
    expect(residentFeedback(s, 'colonist-1')).toEqual(f);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('does not claim a global tank supplies a disconnected home', () => {
    const s = noWater(active()),
      f = residentFeedback(s, 'colonist-1')!;
    expect(s.inventory.water).toBe(100);
    expect(f.mood).toBe('Distressed');
    expect(f.concerns.some((i) => i.code === 'water-connection')).toBe(true);
    expect(f.happyAbout.some((i) => i.code === 'water')).toBe(false);
    expect(f.cityNeeds.some((i) => i.code === 'city-water-connections')).toBe(
      true,
    );
  });
  it('distinguishes an empty connected water component from a missing connection', () => {
    let s = noWater(active());
    const home = s.buildings.find((b) => b.id === s.residents[0]!.homeId)!;
    s = buildInfrastructure(s, 'water', [connectionTiles(home, 'water')[0]!]);
    const f = residentFeedback(s, 'colonist-1')!;
    expect(f.concerns.some((i) => i.code === 'water-empty')).toBe(true);
    expect(f.concerns.some((i) => i.code === 'water-connection')).toBe(false);
  });
  it('prioritizes critical oxygen trouble and never reports it as a positive', () => {
    const s = active();
    s.inventory.oxygen = 0;
    distributeCargo(s);
    const f = residentFeedback(s, 'colonist-1')!;
    expect(f.concerns[0]?.code).toBe('oxygen-empty');
    expect(f.mood).toBe('Distressed');
    expect(f.happyAbout.some((i) => i.code === 'oxygen')).toBe(false);
  });
  it('explains food and power concerns with actual evidence', () => {
    const s = active();
    s.inventory.food = 0.1;
    s.buildings = s.buildings.map((b) =>
      b.id === s.residents[0]!.homeId
        ? { ...b, status: 'no-power' as const }
        : b,
    );
    const f = residentFeedback(s, 'colonist-1')!;
    expect(f.mood).toBe('Concerned');
    expect(f.concerns.map((i) => i.code)).toEqual(
      expect.arrayContaining(['food-low', 'home-power']),
    );
    expect(f.cityNeeds.map((i) => i.code)).toEqual(
      expect.arrayContaining(['city-food', 'city-power']),
    );
  });
  it('returns no conversation for unknown or not-yet-landed people', () => {
    expect(residentFeedback(active(), 'missing')).toBeNull();
    expect(residentFeedback(newGame(), 'colonist-1')).toBeNull();
  });
});
describe('automatic water contacts', () => {
  it('connects pipes touching any of the four sides of a home', () => {
    for (const tile of [
      { x: 1, y: 9 },
      { x: 3, y: 9 },
      { x: 2, y: 8 },
      { x: 2, y: 10 },
    ]) {
      const s = construct(noWater(active()), 'housing', { x: 2, y: 9 }),
        home = s.buildings.at(-1)!;
      const next = buildInfrastructure(s, 'water', [tile]);
      expect(networkFor(next.networks, home.id, 'water')).toBeDefined();
    }
  });
  it('supports the far edge of multi-tile buildings, not diagonals or gaps', () => {
    let s = noWater(active());
    const farm = s.buildings.find((b) => b.type === 'farm')!;
    s = buildInfrastructure(s, 'water', [{ x: farm.x + 3, y: farm.y + 1 }]);
    expect(networkFor(s.networks, farm.id, 'water')).toBeDefined();
    for (const tile of [
      { x: 1, y: 8 },
      { x: 0, y: 9 },
    ]) {
      const empty = construct(noWater(active()), 'housing', { x: 2, y: 9 }),
        home = empty.buildings.at(-1)!;
      expect(
        networkFor(
          buildInfrastructure(empty, 'water', [tile]).networks,
          home.id,
          'water',
        ),
      ).toBeUndefined();
    }
  });
  it('merges touching branches through a tank manifold and counts storage only once', () => {
    let s = noWater(active());
    const tank = s.buildings.find((b) => b.type === 'water-tank')!,
      left = { x: tank.x - 1, y: tank.y },
      right = { x: tank.x + 1, y: tank.y };
    s = buildInfrastructure(buildInfrastructure(s, 'water', [left]), 'water', [
      right,
    ]);
    const networks = s.networks.filter((n) => n.type === 'water');
    expect(networks).toHaveLength(1);
    expect(networks[0]?.storage.filter((id) => id === tank.id)).toHaveLength(1);
    expect(networks[0]?.stored).toBe(100);
    s = buildInfrastructure(s, 'water', [left], true);
    expect(networkFor(s.networks, tank.id, 'water')).toBeDefined();
    s = buildInfrastructure(s, 'water', [right], true);
    expect(networkFor(s.networks, tank.id, 'water')).toBeUndefined();
    expect(s.inventory.water).toBe(100);
  });
  it('migrates old water connection rules without moving resources or creating segments', () => {
    const s = active(),
      old = { ...s, networkRulesVersion: 1 };
    const next = loadSave(JSON.parse(JSON.stringify(old)));
    expect(next.networkRulesVersion).toBe(2);
    expect(next.inventory).toEqual(s.inventory);
    expect(next.infrastructure).toEqual(s.infrastructure);
    expect(next.residents).toEqual(s.residents);
    expect(next.buildings.map((b) => b.stores)).toEqual(
      s.buildings.map((b) => b.stores),
    );
  });
});
