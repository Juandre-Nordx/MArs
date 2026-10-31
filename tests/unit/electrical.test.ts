import { describe, it, expect } from 'vitest';
import {
  buildInfrastructure,
  construct,
  deployColony,
  newGame,
  refreshNetworks,
  networkFor,
  reserve,
  step,
  toggleSegment,
  loadSave,
  routeBetween,
} from '../../packages/simulation/src/index.js';
function isolated() {
  const s = deployColony(newGame());
  return refreshNetworks({
    ...s,
    infrastructure: s.infrastructure.filter((i) => i.type !== 'power'),
  });
}
describe('automatic electrical contacts', () => {
  it('connects all four sides of a powered building', () => {
    for (const tile of [
      { x: 1, y: 9 },
      { x: 3, y: 9 },
      { x: 2, y: 8 },
      { x: 2, y: 10 },
    ]) {
      const s = construct(isolated(), 'housing', { x: 2, y: 9 }),
        home = s.buildings.at(-1)!;
      expect(
        networkFor(
          buildInfrastructure(s, 'power', [tile]).networks,
          home.id,
          'power',
        ),
      ).toBeDefined();
    }
  });
  it('connects far footprint edges but not a diagonal or gap', () => {
    const s = isolated(),
      solar = s.buildings.find((b) => b.type === 'solar')!;
    for (const [tile, connected] of [
      [{ x: solar.x + 3, y: solar.y + 1 }, true],
      [{ x: solar.x + 3, y: solar.y + 2 }, false],
      [{ x: solar.x + 4, y: solar.y }, false],
    ] as const)
      expect(
        !!networkFor(
          buildInfrastructure(s, 'power', [tile]).networks,
          solar.id,
          'power',
        ),
      ).toBe(connected);
  });
  it('joins battery contacts once, keeps charge unchanged on edits, and disconnects only after all contacts fail', () => {
    let s = isolated();
    const battery = s.buildings.find((b) => b.type === 'battery')!,
      a = { x: battery.x - 1, y: battery.y },
      b = { x: battery.x + 2, y: battery.y };
    s = buildInfrastructure(buildInfrastructure(s, 'power', [a]), 'power', [b]);
    const grid = networkFor(s.networks, battery.id, 'power')!;
    expect(s.networks.filter((n) => n.type === 'power')).toHaveLength(1);
    expect(grid.storage).toEqual([battery.id]);
    expect(reserve(s, grid)).toBe(120);
    expect(step(s).inventory.energy).toBe(120);
    s = toggleSegment(s, `power:${a.x},${a.y}`);
    expect(networkFor(s.networks, battery.id, 'power')).toBeDefined();
    s = toggleSegment(s, `power:${b.x},${b.y}`);
    expect(networkFor(s.networks, battery.id, 'power')).toBeUndefined();
    expect(s.inventory.energy).toBe(120);
  });
  it('powers a company through side-only cables and does not draw an isolated battery', () => {
    let s = isolated();
    s = buildInfrastructure(
      s,
      'power',
      routeBetween({ x: 3, y: 8 }, { x: 3, y: 14 }),
    );
    const next = step(s);
    expect(
      next.buildings.find((b) => b.type === 'oxygen-generator')?.status,
    ).toBe('running');
    expect(next.telemetry.generated).toBe(8);
    expect(next.telemetry.used).toBe(2);
    expect(next.telemetry.produced.oxygen).toBe(0.16);
    expect(next.inventory.energy).toBe(120);
  });
  it('counts solar generation once and charges/discharges connected batteries correctly', () => {
    let s = buildInfrastructure(isolated(), 'power', [
      ...routeBetween({ x: 3, y: 8 }, { x: 3, y: 13 }),
      ...routeBetween({ x: 3, y: 13 }, { x: 8, y: 13 }),
      { x: 8, y: 14 },
    ]);
    const day = step(s);
    expect(day.telemetry.generated).toBe(8);
    expect(day.telemetry.used).toBe(2);
    expect(day.inventory.energy).toBe(126);
    s = { ...day, tick: 180 };
    expect(step(s).inventory.energy).toBe(124);
  });
  it('does not connect a building with no electrical system', () => {
    const s = isolated(),
      warehouse = s.buildings.find((b) => b.type === 'warehouse')!;
    const next = buildInfrastructure(s, 'power', [
      { x: warehouse.x - 1, y: warehouse.y },
    ]);
    expect(networkFor(next.networks, warehouse.id, 'power')).toBeUndefined();
  });
  it('migrates all previous rule versions without adding energy or changing entities', () => {
    const s = deployColony(newGame());
    for (const version of [1, 2, 3]) {
      const next = loadSave({ ...s, networkRulesVersion: version });
      expect(next.networkRulesVersion).toBe(4);
      expect(next.inventory).toEqual(s.inventory);
      expect(next.infrastructure).toEqual(s.infrastructure);
      expect(next.residents).toEqual(s.residents);
      expect(next.buildings.map((b) => b.stores)).toEqual(
        s.buildings.map((b) => b.stores),
      );
    }
  });
});
