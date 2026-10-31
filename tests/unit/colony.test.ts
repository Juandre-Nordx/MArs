import { describe, expect, it } from 'vitest';
import {
  accessible,
  advance,
  alerts,
  buildingAt,
  buildingDefinitions,
  capacities,
  colonySchema,
  construct,
  deployColony,
  distributeCargo,
  emptyStock,
  footprint,
  generateTerrain,
  landingCargo,
  loadSave,
  newGame,
  placement,
  populationRates,
  resourceKeys,
  setSpeed,
  SOL_TICKS,
  step,
  toggleBuilding,
  type ColonyState,
} from '../../packages/simulation/src/index.js';
const active = (seed = 1) => deployColony(newGame(seed));
function disable(state: ColonyState, types: string[]) {
  return {
    ...state,
    buildings: state.buildings.map((b) => ({
      ...b,
      enabled: !types.includes(b.type) && b.enabled,
    })),
  };
}
describe('terrain and deployment', () => {
  it('generates repeatable, varied surfaces from a seed without storing collision decorations', () => {
    expect(generateTerrain(7)).toEqual(generateTerrain(7));
    expect(generateTerrain(7)).not.toEqual(generateTerrain(8));
    expect(new Set(generateTerrain(7).map((t) => t.texture)).size).toBe(3);
    expect(generateTerrain(7).some((t) => t.decoration === 'boulder')).toBe(
      true,
    );
  });
  it('starts with explicit cargo, 10 population and landing held before deployment', () => {
    const state = newGame(7);
    expect(state.phase).toBe('landing');
    expect(state.population).toBe(10);
    expect(state.buildings).toEqual([]);
    expect(state.inventory).toEqual(landingCargo);
    expect(advance({ colony: state, remainderMs: 0 }, 5000).colony).toBe(state);
  });
  it('places exactly 10 houses and all starter facilities without overlaps and with access across seeds', () => {
    for (let seed = 0; seed < 50; seed++) {
      const state = active(seed);
      expect(state.buildings).toHaveLength(19);
      expect(state.buildings.filter((b) => b.type === 'housing')).toHaveLength(
        10,
      );
      for (const type of Object.keys(buildingDefinitions).filter(
        (type) => type !== 'housing',
      ))
        expect(state.buildings.filter((b) => b.type === type)).toHaveLength(1);
      expect(new Set(state.buildings.map((b) => b.id)).size).toBe(19);
      expect(accessible(state.buildings)).toBe(true);
      expect(colonySchema.safeParse(state).success).toBe(true);
      const cells = state.buildings.flatMap((b) =>
        footprint(b.type, b).map((t) => `${t.x},${t.y}`),
      );
      expect(new Set(cells).size).toBe(cells.length);
    }
  });
  it('never redeploys when touchdown is repeated or active saves are loaded', () => {
    const state = active();
    expect(deployColony(state)).toBe(state);
    const restored = loadSave(JSON.parse(JSON.stringify(state)));
    expect(deployColony(restored)).toEqual(state);
    expect(
      deployColony(loadSave(JSON.parse(JSON.stringify(newGame())))),
    ).toEqual(state);
    expect(() =>
      loadSave({
        ...state,
        buildings: [...state.buildings, state.buildings[0]],
      }),
    ).toThrow();
  });
  it('migrates version 1 without inventing new resources and rejects unsupported/malformed saves', () => {
    const legacy = {
      schemaVersion: 1,
      seed: 1,
      tick: 42,
      name: 'Legacy',
      inventory: { water: 33, oxygen: 24, metal: 8 },
    };
    const migrated = loadSave(legacy);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.tick).toBe(42);
    expect(migrated.inventory).toEqual({
      ...emptyStock(),
      ...legacy.inventory,
    });
    expect(migrated.buildings).toHaveLength(19);
    expect(migrated.credits).toBe(0);
    expect(() =>
      loadSave({ ...legacy, inventory: { ...legacy.inventory, water: -1 } }),
    ).toThrow();
    expect(() => loadSave({ ...active(), schemaVersion: 5 })).toThrow();
    expect(() =>
      loadSave({ ...newGame(), landingZone: { x: 99, y: 99 } }),
    ).toThrow();
    expect(() =>
      loadSave({
        ...active(),
        inventory: { ...active().inventory, energy: 9999 },
      }),
    ).toThrow();
  });
});
describe('survival and power', () => {
  it('consumes population requirements exactly without active production', () => {
    const state = disable(active(), [
      'oxygen-generator',
      'water-recycler',
      'farm',
    ]);
    const next = step(state);
    for (const key of ['oxygen', 'water', 'food'] as const)
      expect(next.inventory[key]).toBeCloseTo(
        state.inventory[key] - 10 * populationRates[key],
        6,
      );
    expect(state.inventory).toEqual(landingCargo);
    expect(next.inventory.wastewater).toBeCloseTo(
      state.inventory.wastewater + 0.06,
      6,
    );
    expect(next.inventory.carbonDioxide).toBeCloseTo(
      state.inventory.carbonDioxide + 0.1,
      6,
    );
  });
  it('funds oxygen, water and food production from feedstocks and electricity', () => {
    const state = active();
    const next = step(state);
    expect(next.inventory.water).toBe(99.76);
    expect(next.inventory.oxygen).toBe(100.08);
    expect(next.inventory.food).toBe(60.02);
    expect(next.inventory.nutrients).toBe(79.99);
    expect(next.inventory.wastewater).toBe(59.96);
    expect(next.telemetry.generated).toBe(8);
    expect(next.telemetry.used).toBeCloseTo(6);
    expect(next.inventory.energy).toBe(122);
    for (const key of resourceKeys.filter((key) => key !== 'energy'))
      expect(next.inventory[key]).toBeCloseTo(
        state.inventory[key] +
          next.telemetry.produced[key] -
          next.telemetry.consumed[key],
        6,
      );
  });
  it('stops production with no power and never spends unavailable input stock', () => {
    const state = disable(active(), ['solar']);
    state.inventory.energy = 0;
    distributeCargo(state);
    const next = step(state);
    expect(
      next.buildings.find((b) => b.type === 'oxygen-generator')?.status,
    ).toBe('no-power');
    expect(next.telemetry.produced.oxygen).toBe(0);
    expect(next.inventory.oxygen).toBe(99.9);
    expect(next.inventory.energy).toBe(0);
    const almost = active();
    almost.inventory.water = 0.199999;
    distributeCargo(almost);
    expect(
      step(almost).buildings.find((b) => b.type === 'oxygen-generator')?.status,
    ).toBe('no-input');
    const dry = active();
    dry.inventory.water = 0;
    distributeCargo(dry);
    const nextDry = step(dry);
    expect(
      nextDry.buildings.find((b) => b.type === 'oxygen-generator')?.status,
    ).toBe('no-input');
    expect(nextDry.telemetry.produced.oxygen).toBeCloseTo(0.02); // Farm can use recycler output later in this fixed building order.
  });
  it('uses daylight only, discharges stored energy at night and bounds the battery', () => {
    const state = active();
    state.tick = Math.floor(SOL_TICKS * 0.75);
    const next = step(state);
    expect(next.telemetry.generated).toBe(0);
    expect(next.inventory.energy).toBe(114);
    expect(next.telemetry.batteryDelta).toBe(-6);
    const full = active();
    full.inventory.energy = capacities(full).energy;
    distributeCargo(full);
    expect(step(full).inventory.energy).toBe(capacities(full).energy);
  });
  it('stalls full output stores without charging recipe inputs', () => {
    const state = disable(active(), ['farm']);
    state.inventory.oxygen = capacities(state).oxygen;
    distributeCargo(state);
    const next = step(state);
    expect(
      next.buildings.find((b) => b.type === 'oxygen-generator')?.status,
    ).toBe('storage-full');
    expect(next.telemetry.consumed.water).toBeCloseTo(0.08);
    expect(next.telemetry.produced.oxygen).toBe(0);
  });
  it('never exceeds storage or goes negative across long running shortages', () => {
    let state = active();
    for (let i = 0; i < 1500; i++) {
      state = step(state);
      const cap = capacities(state);
      for (const key of resourceKeys) {
        expect(state.inventory[key]).toBeGreaterThanOrEqual(0);
        expect(state.inventory[key]).toBeLessThanOrEqual(cap[key]);
      }
    }
    expect(alerts(state).some((a) => a.includes('Critical'))).toBe(true);
  });
  it('keeps disabled battery storage isolated from the grid', () => {
    const state = disable(active(), ['solar', 'battery']);
    const next = step(state);
    expect(next.inventory.energy).toBe(state.inventory.energy);
    expect(
      next.buildings.find((b) => b.type === 'oxygen-generator')?.status,
    ).toBe('no-power');
  });
  it('does not assign more workers than the population and stops understaffed facilities', () => {
    let state = active();
    state.population = 1;
    state.residents = state.residents.slice(0, 1);
    state = step(state);
    expect(
      state.buildings.reduce((sum, b) => sum + b.workers, 0),
    ).toBeLessThanOrEqual(1);
    expect(state.buildings.find((b) => b.type === 'farm')?.status).toBe(
      'no-workers',
    );
    expect(alerts(state)).toContain('Insufficient workers: facilities stopped');
  });
  it('reports low reserves and unmet needs without negative consumption', () => {
    const state = disable(active(), [
      'oxygen-generator',
      'water-recycler',
      'farm',
      'solar',
    ]);
    state.inventory = { ...emptyStock(), metal: 10 };
    distributeCargo(state);
    const next = step(state);
    expect(alerts(next)).toContain('Critical: unmet oxygen demand');
    expect(alerts(next)).toContain('Low energy reserves');
    expect(next.inventory.oxygen).toBe(0);
    expect(next.telemetry.consumed.oxygen).toBe(0);
    expect(next.telemetry.unmet.oxygen).toBe(0.1);
  });
  it('supports pause and 1× / 2× / 4× with deterministic frame partitioning', () => {
    const state = active();
    const original = JSON.stringify(state);
    expect(
      advance({ colony: setSpeed(state, 0), remainderMs: 400 }, 9000).colony
        .tick,
    ).toBe(0);
    for (const speed of [1, 2, 4] as const) {
      const initial = { colony: setSpeed(state, speed), remainderMs: 0 };
      let split = initial;
      for (const delta of [17, 83, 900, 1700, 300])
        split = advance(split, delta);
      expect(split).toEqual(advance(initial, 3000));
      expect(split.colony.tick).toBe(3 * speed);
    }
    expect(JSON.stringify(state)).toBe(original);
    expect(() => setSpeed(state, 3 as 1)).toThrow();
  });
});
describe('building interactions and construction', () => {
  it('resolves every cell of a multi-tile building to its unique instance', () => {
    const state = active();
    const farm = state.buildings.find((b) => b.type === 'farm')!;
    for (const cell of footprint('farm', farm))
      expect(buildingAt(state, cell)?.id).toBe(farm.id);
    expect(buildingAt(state, { x: 0, y: 0 })).toBeUndefined();
  });
  it('validates bounds, collision, affordability and charges costs exactly once', () => {
    const state = active();
    const tile = { x: 2, y: 2 };
    expect(placement(state, 'housing', tile).valid).toBe(true);
    expect(placement(state, 'housing', { x: 0, y: 0 }).valid).toBe(true);
    expect(placement(state, 'solar', { x: 19, y: 19 }).valid).toBe(false);
    expect(placement(state, 'housing', state.buildings[0]!).valid).toBe(false);
    expect(placement(state, 'starship', tile).valid).toBe(false);
    const next = construct(state, 'housing', tile);
    expect(next.buildings).toHaveLength(20);
    expect(next.inventory.metal).toBe(72);
    expect(next.credits).toBe(95);
    expect(state.inventory.metal).toBe(80);
    expect(() => construct(next, 'housing', tile)).toThrow();
    expect(next.inventory.metal).toBe(72);
    expect(() =>
      construct({ ...state, credits: 0 }, 'housing', tile),
    ).toThrow();
    expect(() => construct(newGame(), 'housing', tile)).toThrow();
  });
  it('rejects disconnected enclosed buildings', () => {
    const state = active();
    const house = state.buildings.find((b) => b.type === 'housing')!;
    const ring = [
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 1 },
      { x: 2, y: 3 },
    ].map((t, i) => ({ ...house, ...t, id: `wall-${i}` }));
    expect(accessible([...ring, { ...house, x: 2, y: 2, id: 'trapped' }])).toBe(
      false,
    );
  });
  it('disables and reenables a facility through simulation state only', () => {
    const state = active();
    const oxygen = state.buildings.find((b) => b.type === 'oxygen-generator')!;
    const disabled = toggleBuilding(state, oxygen.id);
    expect(
      step(disabled).buildings.find((b) => b.id === oxygen.id)?.status,
    ).toBe('disabled');
    expect(step(disabled).telemetry.produced.oxygen).toBeCloseTo(0.02);
    expect(
      step(toggleBuilding(disabled, oxygen.id)).telemetry.produced.oxygen,
    ).toBeCloseTo(0.18);
    expect(oxygen.enabled).toBe(true);
  });
});
