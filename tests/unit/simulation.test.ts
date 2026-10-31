import { describe, expect, it } from 'vitest';
import {
  advance,
  deployColony,
  applyRecipe,
  landingCargo,
  loadSave,
  newGame,
  step,
  transfer,
} from '../../packages/simulation/src/index.js';
describe('deterministic simulation', () => {
  it('produces identical state for identical elapsed time split across frames', () => {
    const initial = { colony: deployColony(newGame(42)), remainderMs: 0 };
    let split = initial;
    for (const elapsed of [16, 984, 2250, 750, 500])
      split = advance(split, elapsed);
    expect(split).toEqual(advance(initial, 4500));
    expect(split.colony.tick).toBe(4);
    expect(split.remainderMs).toBe(500);
  });
  it('holds resources before landing and advances an immutable deployed state', () => {
    const state = newGame();
    const next = step(deployColony(state));
    expect(next.tick).toBe(1);
    expect(state.tick).toBe(0);
    expect(state.inventory).toEqual(landingCargo);
    expect(next.inventory.water).toBeLessThan(state.inventory.water);
    expect(
      advance({ colony: state, remainderMs: 0 }, 86400000).colony.inventory,
    ).toEqual(landingCargo);
  });
  it('does not share mutable starting inventory', () => {
    const a = newGame();
    a.inventory.water = 0;
    expect(newGame().inventory.water).toBe(100);
  });
  it('rejects invalid time and unsupported save versions', () => {
    expect(() => advance({ colony: newGame(), remainderMs: 0 }, -1)).toThrow();
    expect(() =>
      advance({ colony: newGame(), remainderMs: 0 }, Infinity),
    ).toThrow();
    expect(() => loadSave({ ...newGame(), schemaVersion: 999 })).toThrow();
    expect(loadSave(JSON.parse(JSON.stringify(newGame())))).toEqual(newGame());
  });
});
describe('economic invariants', () => {
  const empty = { water: 0, oxygen: 0, metal: 0 };
  it('conserves every resource in a transfer and leaves inputs intact', () => {
    const source = { water: 40, oxygen: 30, metal: 20 };
    const target = { water: 5, oxygen: 6, metal: 7 };
    const result = transfer(source, target, { water: 12, oxygen: 4, metal: 0 });
    for (const key of ['water', 'oxygen', 'metal'] as const)
      expect(result.source[key] + result.target[key]).toBe(
        source[key] + target[key],
      );
    expect(source.water).toBe(40);
    expect(target.water).toBe(5);
  });
  it('rejects negative transfers and overdrafts atomically', () => {
    const source = { ...empty, water: 3 };
    expect(() => transfer(source, empty, { ...empty, water: 4 })).toThrow();
    expect(() => transfer(source, empty, { ...empty, water: -1 })).toThrow();
    expect(source.water).toBe(3);
  });
  it('requires recipe inputs, charges them and rejects insufficient stock', () => {
    const recipe = {
      id: 'test-conversion',
      inputs: { ...empty, water: 2 },
      outputs: { ...empty, oxygen: 1 },
    };
    expect(applyRecipe({ ...empty, water: 3 }, recipe)).toEqual({
      water: 1,
      oxygen: 1,
      metal: 0,
    });
    expect(() => applyRecipe(empty, recipe)).toThrow();
    expect(() => applyRecipe(empty, { ...recipe, inputs: empty })).toThrow();
    expect(() =>
      applyRecipe(empty, { ...recipe, outputs: { ...empty, oxygen: -1 } }),
    ).toThrow();
  });
});
