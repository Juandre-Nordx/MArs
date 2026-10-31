import { describe, expect, it } from 'vitest';
import {
  advance,
  arrivalReadiness,
  buildInfrastructure,
  cells,
  colonySchema,
  construct,
  deployColony,
  distributeCargo,
  loadSave,
  networkFor,
  newGame,
  port,
  step,
  toggleArrivals,
  walkingPath,
  type ColonyState,
} from '../../packages/simulation/src/index.js';
const active = () => deployColony(newGame());
function vacancy() {
  let state = construct(active(), 'housing', { x: 2, y: 9 });
  const home = state.buildings.at(-1)!;
  for (const type of ['water', 'oxygen', 'power'] as const) {
    const network = networkFor(state.networks, 'starter-0', type)!;
    const segment = state.infrastructure.find(
      (s) => s.id === network.segments[0],
    )!;
    const endpoint = port(home, type)!;
    const path = walkingPath(state, endpoint, segment);
    if (!path) throw new Error('Missing fixture route');
    state = buildInfrastructure(state, type, [endpoint, ...path]);
  }
  return state;
}
function run(state: ColonyState, ticks: number) {
  for (let i = 0; i < ticks; i++) state = step(state);
  return state;
}
describe('resident movement and consumption', () => {
  it('creates ten uniquely housed residents without changing starter reserves', () => {
    const s = active();
    expect(s.residents).toHaveLength(10);
    expect(new Set(s.residents.map((r) => r.homeId)).size).toBe(10);
    expect(new Set(s.residents.map((r) => r.id)).size).toBe(10);
    expect(s.inventory.water).toBe(100);
    expect(colonySchema.safeParse(s).success).toBe(true);
  });
  it('walks between real buildings without crossing footprints and preserves inputs', () => {
    const initial = active(),
      snapshot = JSON.stringify(initial);
    let s = initial;
    let moved = false;
    for (let i = 0; i < 60; i++) {
      s = step(s);
      const blocked = new Set(
        s.buildings.flatMap((b) => cells(b).map((t) => `${t.x},${t.y}`)),
      );
      for (const r of s.residents) {
        expect(blocked.has(`${r.position.x},${r.position.y}`)).toBe(false);
        if (
          r.position.x !== r.previousPosition.x ||
          r.position.y !== r.previousPosition.y
        )
          moved = true;
      }
    }
    expect(moved).toBe(true);
    expect(JSON.stringify(initial)).toBe(snapshot);
  });
  it('charges rations once per resident including while walking', () => {
    const s = active();
    s.buildings = s.buildings.map((b) => ({
      ...b,
      enabled: !['oxygen-generator', 'farm', 'water-recycler'].includes(b.type),
    }));
    const next = step(s);
    expect(next.telemetry.consumed.water).toBeCloseTo(0.08);
    expect(next.telemetry.consumed.oxygen).toBeCloseTo(0.1);
    expect(next.telemetry.consumed.food).toBeCloseTo(0.03);
    expect(run(s, 10).inventory.food).toBeCloseTo(59.7);
  });
  it('holds movement and arrivals while paused and remains frame-partition deterministic', () => {
    const s = vacancy(),
      clock = { colony: s, remainderMs: 0 };
    expect(advance(advance(clock, 1700), 6300)).toEqual(advance(clock, 8000));
    const paused = { ...s, speed: 0 as const };
    expect(advance({ colony: paused, remainderMs: 100 }, 5000).colony).toBe(
      paused,
    );
  });
  it('has no route through an enclosed door', () => {
    const s = active();
    expect(walkingPath(s, { x: 0, y: 0 }, s.buildings[0]!)).toBeNull();
  });
});
describe('buggy immigration', () => {
  it('waits when there are no vacant beds or a home lacks connections', () => {
    expect(arrivalReadiness(active()).reason).toContain('no vacant beds');
    const s = construct(active(), 'housing', { x: 2, y: 9 });
    expect(arrivalReadiness(s).ready).toBe(false);
    expect(run(s, 100).population).toBe(10);
  });
  it('requires food and local utility reserves rather than giving free supplies', () => {
    const s = vacancy();
    expect(arrivalReadiness(s).ready).toBe(true);
    s.inventory.food = 0;
    expect(arrivalReadiness(s).ready).toBe(false);
    s.inventory.food = 60;
    s.inventory.water = 0;
    distributeCargo(s);
    expect(arrivalReadiness(s).ready).toBe(false);
  });
  it('spawns a buggy first and admits exactly one newcomer only at drop-off', () => {
    const initial = vacancy();
    let s = run(initial, 30);
    expect(s.immigration.convoy?.phase).toBe('arriving');
    expect(s.population).toBe(10);
    let travelled = false;
    for (let i = 0; i < 100 && s.population === 10; i++) {
      const beforeState = s;
      const before = s.immigration.convoy?.position;
      s = step(s);
      if (s.population > beforeState.population)
        for (const key of ['water', 'oxygen', 'food'] as const)
          expect(s.inventory[key]).toBeCloseTo(
            beforeState.inventory[key] +
              s.telemetry.produced[key] -
              s.telemetry.consumed[key],
            6,
          );
      if (
        before &&
        s.immigration.convoy &&
        (before.x !== s.immigration.convoy.position.x ||
          before.y !== s.immigration.convoy.position.y)
      )
        travelled = true;
    }
    expect(travelled).toBe(true);
    expect(s.population).toBe(11);
    expect(s.residents).toHaveLength(11);
    expect(s.immigration.convoy?.phase).toBe('departing');
    expect(s.inventory.food).toBeLessThanOrEqual(initial.inventory.food + 2);
    const next = step(s);
    expect(next.telemetry.consumed.food).toBeCloseTo(0.033);
    expect(run(s, 150).population).toBe(11);
    expect(colonySchema.safeParse(s).success).toBe(true);
  });
  it('rechecks resources at the destination and turns away without adding people', () => {
    let s = run(vacancy(), 30);
    s.inventory.food = 0;
    while (s.immigration.convoy?.phase === 'arriving') s = step(s);
    expect(s.population).toBe(10);
    expect(s.immigration.lastEvent).toContain('turned away');
  });
  it('holds immigration during an existing settlement power failure', () => {
    const s = vacancy();
    s.buildings = s.buildings.map((b) =>
      b.type === 'starship' ? { ...b, status: 'no-power' as const } : b,
    );
    expect(arrivalReadiness(s).ready).toBe(false);
  });
  it('honors pausing arrivals while a buggy is already travelling', () => {
    const s = toggleArrivals(run(vacancy(), 30));
    const next = run(s, 40);
    expect(next.population).toBe(10);
    expect(next.immigration.lastEvent).toContain('turned away');
  });
  it('can pause new arrivals independently of simulation time', () => {
    const s = toggleArrivals(vacancy());
    expect(run(s, 100).population).toBe(10);
    expect(arrivalReadiness(s).reason).toBe('Arrivals paused');
  });
  it('persists walking routes and in-flight/drop-off state without duplicate passengers', () => {
    const s = run(vacancy(), 33);
    const restored = loadSave(JSON.parse(JSON.stringify(s)));
    expect(restored.residents).toEqual(s.residents);
    expect(restored.immigration).toEqual(s.immigration);
    let arrived = run(restored, 40);
    expect(arrived.population).toBe(11);
    arrived = loadSave(JSON.parse(JSON.stringify(arrived)));
    expect(run(arrived, 60).population).toBe(11);
  });
  it('migrates version 3 without changing supplies, identities of buildings or population', () => {
    const s = active();
    const { residents: _r, nextResidentId: _n, immigration: _i, ...old } = s;
    void _r;
    void _n;
    void _i;
    const migrated = loadSave({
      ...old,
      schemaVersion: 3,
      networkRulesVersion: 1,
    });
    expect(migrated.inventory).toEqual(s.inventory);
    expect(migrated.buildings).toEqual(s.buildings);
    expect(migrated.population).toBe(10);
    expect(migrated.residents).toHaveLength(10);
    expect(migrated.schemaVersion).toBe(4);
    expect(() =>
      loadSave({
        ...migrated,
        residents: [...migrated.residents, migrated.residents[0]],
      }),
    ).toThrow();
  });
});
