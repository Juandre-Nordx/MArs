import { describe, it, expect } from 'vitest';
import {
  buildInfrastructure,
  construct,
  door,
  deployColony,
  newGame,
  refreshNetworks,
  networkFor,
  loadSave,
  toggleSegment,
  reserve,
  type InfrastructureType,
} from '../../packages/simulation/src/index.js';
const active = () => deployColony(newGame());
const without = (type: InfrastructureType) => {
  const s = active();
  return refreshNetworks({
    ...s,
    infrastructure: s.infrastructure.filter((i) => i.type !== type),
  });
};
describe('adjacent oxygen and road access', () => {
  for (const type of ['oxygen', 'road'] as const)
    it(`attaches ${type} on every side of housing`, () => {
      for (const tile of [
        { x: 1, y: 9 },
        { x: 3, y: 9 },
        { x: 2, y: 8 },
        { x: 2, y: 10 },
      ]) {
        const s = construct(without(type), 'housing', { x: 2, y: 9 }),
          home = s.buildings.at(-1)!;
        expect(
          networkFor(
            buildInfrastructure(s, type, [tile]).networks,
            home.id,
            type,
          ),
        ).toBeDefined();
      }
    });
  for (const type of ['oxygen', 'road'] as const)
    it(`attaches ${type} on far edges of multi-tile buildings and rejects gaps/diagonals`, () => {
      const s = without(type),
        farm = s.buildings.find((b) => b.type === 'farm')!;
      for (const [tile, connected] of [
        [{ x: farm.x + 3, y: farm.y + 1 }, true],
        [{ x: farm.x + 3, y: farm.y + 2 }, false],
        [{ x: farm.x + 4, y: farm.y + 1 }, false],
      ] as const) {
        expect(
          !!networkFor(
            buildInfrastructure(s, type, [tile]).networks,
            farm.id,
            type,
          ),
        ).toBe(connected);
      }
    });
  it('joins oxygen branches via a tank once and retains all stored oxygen', () => {
    let s = without('oxygen');
    const tank = s.buildings.find((b) => b.type === 'oxygen-tank')!,
      left = { x: tank.x - 1, y: tank.y },
      right = { x: tank.x + 1, y: tank.y };
    s = buildInfrastructure(
      buildInfrastructure(s, 'oxygen', [left]),
      'oxygen',
      [right],
    );
    const n = networkFor(s.networks, tank.id, 'oxygen')!;
    expect(s.networks.filter((n) => n.type === 'oxygen')).toHaveLength(1);
    expect(n.storage.filter((id) => id === tank.id)).toHaveLength(1);
    expect(reserve(s, n)).toBe(100);
    s = toggleSegment(s, `oxygen:${left.x},${left.y}`);
    expect(networkFor(s.networks, tank.id, 'oxygen')).toBeDefined();
    s = toggleSegment(s, `oxygen:${right.x},${right.y}`);
    expect(networkFor(s.networks, tank.id, 'oxygen')).toBeUndefined();
    expect(s.inventory.oxygen).toBe(100);
  });
  it('exposes both adjacent road components without routing through a building', () => {
    let s = construct(without('road'), 'housing', { x: 2, y: 9 });
    const home = s.buildings.at(-1)!;
    s = buildInfrastructure(
      buildInfrastructure(s, 'road', [{ x: 1, y: 9 }]),
      'road',
      [{ x: 3, y: 9 }],
    );
    const access = s.networks.filter(
      (n) => n.type === 'road' && n.buildings.includes(home.id),
    );
    expect(access).toHaveLength(2);
    expect(access.every((n) => n.segments.length === 1)).toBe(true);
  });
  it('does not attach oxygen to a building that has no oxygen plumbing', () => {
    const s = without('oxygen'),
      warehouse = s.buildings.find((b) => b.type === 'warehouse')!;
    expect(
      networkFor(
        buildInfrastructure(s, 'oxygen', [
          { x: warehouse.x - 1, y: warehouse.y },
        ]).networks,
        warehouse.id,
        'oxygen',
      ),
    ).toBeUndefined();
  });
  it('migrates both previous network-rule versions without resource or entity changes', () => {
    const s = active();
    for (const version of [1, 2]) {
      const next = loadSave({ ...s, networkRulesVersion: version });
      expect(next.networkRulesVersion).toBe(3);
      expect(next.inventory).toEqual(s.inventory);
      expect(next.infrastructure).toEqual(s.infrastructure);
      expect(next.residents).toEqual(s.residents);
      expect(next.buildings.map((b) => b.stores)).toEqual(
        s.buildings.map((b) => b.stores),
      );
    }
  });
});

it('prefers an actual side road entrance over an unconnected north edge', () => {
  let s = construct(without('road'), 'housing', { x: 2, y: 9 });
  const home = s.buildings.at(-1)!;
  s = buildInfrastructure(s, 'road', [{ x: 1, y: 9 }]);
  expect(door(s, home)).toEqual({ x: 1, y: 9 });
});
