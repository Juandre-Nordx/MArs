import { legacyGame as newGame } from '../helpers/landing.js';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  chunkKey,
  generateChunk,
  generateDeposits,
  hash,
  isExplored,
  newWorld,
  revealArea,
  worldSchema,
  terrainAt,
  deployColony,
  loadSave,
  construct,
  placement,
  buildInfrastructure,
  walkingPath,
  step,
  type ColonyState,
} from '../../packages/simulation/src/index.js';
import { terrainWindow } from '../../apps/web/src/world3d/terrain.js';
describe('512-tile world foundation', () => {
  it('generates repeatable chunks independent of generation order and covers all four regions', () => {
    const a = generateChunk(73, 31, 31);
    generateChunk(73, 0, 0);
    expect(a).toEqual(generateChunk(73, 31, 31));
    expect(a).not.toEqual(generateChunk(74, 31, 31));
    expect(a).toHaveLength(256);
    expect(a.at(-1)).toMatchObject({ x: 511, y: 511 });
    const regions = new Set<string>();
    for (let y = 0; y < 512; y += 48)
      for (let x = 0; x < 512; x += 48) regions.add(terrainAt(73, x, y).region);
    expect(regions.size).toBe(4);
    expect(() => generateChunk(73, 32, 0)).toThrow();
  });
  it('preserves every original terrain texture, decoration and shade for varied seeds', () => {
    for (const seed of [0, 1, 37, 2147483647])
      for (let y = 0; y < 20; y++)
        for (let x = 0; x < 20; x++) {
          const h = hash(seed, x, y);
          expect(terrainAt(seed, x, y)).toEqual({
            x,
            y,
            region: 'plains',
            texture: h % 7 === 0 ? 'basalt' : h % 3 === 0 ? 'sand' : 'dust',
            decoration:
              h % 17 === 0
                ? 'boulder'
                : h % 7 === 0
                  ? 'rock'
                  : h % 4 === 0
                    ? 'ripples'
                    : 'none',
            shade: h % 3,
          });
        }
  });
  it('persists partial exploration without revealing unseen tiles, minerals or refreshing spent reserves', () => {
    const initial = newWorld(1),
      base = generateDeposits(1, 20, 20);
    expect(isExplored(initial, { x: 19, y: 19 })).toBe(true);
    expect(isExplored(initial, { x: 20, y: 19 })).toBe(false);
    const next = revealArea(initial, 1, { x: 320, y: 320 }, { x: 321, y: 321 });
    expect(next.chunks['20,20']!.deposits).toEqual(base);
    next.chunks['20,20']!.deposits[0]!.remainingQuantity = 0;
    const again = revealArea(next, 1, { x: 321, y: 321 }, { x: 322, y: 322 });
    expect(again.chunks['20,20']!.deposits[0]!.remainingQuantity).toBe(0);
    expect(again.chunks['20,20']!.deposits.every((d) => !d.discovered)).toBe(
      true,
    );
    expect(isExplored(again, { x: 323, y: 323 })).toBe(false);
    expect(initial.chunks['20,20']).toBeUndefined();
    const state = deployColony(newGame());
    state.world = again;
    expect(loadSave(JSON.parse(JSON.stringify(state))).world).toEqual(again);
    expect(() =>
      revealArea(initial, 1, { x: 0, y: 0 }, { x: 512, y: 511 }),
    ).toThrow();
  });
  it('defines accessible finite starter feedstocks for every seed without supplying them to inventory', () => {
    for (let seed = 0; seed < 50; seed++) {
      const starter = generateDeposits(seed, 1, 1);
      expect(new Set(starter.map((d) => d.resource))).toEqual(
        new Set([
          'iron',
          'aluminium',
          'copper',
          'lithium',
          'silicon',
          'carbon',
          'ice',
        ]),
      );
      for (const d of starter) {
        expect(d.remainingQuantity).toBe(d.initialQuantity);
        expect(d.remainingQuantity).toBeGreaterThan(0);
        expect(d.x).toBeGreaterThan(19);
        expect(d.x).toBeLessThan(32);
        expect(d.discovered).toBe(false);
      }
    }
  });
  it('upgrades an actual schema-4 shape without moving entities or altering supplies and is idempotent', () => {
    const current = deployColony(newGame(37));
    const {
      catalogue: _catalogue,
      production: _production,
      industry: _industry,
      world: _world,
      ...old
    } = current;
    void _catalogue;
    void _production;
    void _industry;
    void _world;
    const upgraded = loadSave({
      ...old,
      schemaVersion: 4,
      networkRulesVersion: 3,
    });
    expect(upgraded.schemaVersion).toBe(8);
    expect(upgraded.world.width).toBe(512);
    for (const key of [
      'buildings',
      'infrastructure',
      'residents',
      'immigration',
      'inventory',
      'landingZone',
      'credits',
      'tick',
    ] as const)
      expect(upgraded[key]).toEqual(current[key]);
    expect(loadSave(JSON.parse(JSON.stringify(upgraded)))).toEqual(upgraded);
  });
  it('uses distant global coordinates, gates construction behind fog and preserves far infrastructure', () => {
    let state = deployColony(newGame());
    expect(placement(state, 'housing', { x: 500, y: 500 })).toMatchObject({
      valid: false,
      reason: 'Explore this terrain before building',
    });
    expect(() =>
      buildInfrastructure(state, 'power', [{ x: 500, y: 499 }]),
    ).toThrow('Explore');
    state = {
      ...state,
      world: revealArea(
        state.world,
        state.seed,
        { x: 499, y: 499 },
        { x: 511, y: 511 },
      ),
    };
    state = construct(state, 'housing', { x: 500, y: 500 });
    state = buildInfrastructure(state, 'power', [{ x: 500, y: 499 }]);
    expect(state.buildings.at(-1)).toMatchObject({ x: 500, y: 500 });
    expect(placement(state, 'solar', { x: 511, y: 511 }).valid).toBe(false);
    expect(loadSave(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it('rejects malformed chunk coordinates, duplicates and replenished reserves', () => {
    const world = newWorld(1),
      chunk = world.chunks['0,0']!;
    expect(
      worldSchema.safeParse({ ...world, chunks: { bad: chunk } }).success,
    ).toBe(false);
    expect(
      worldSchema.safeParse({
        ...world,
        chunks: { '0,0': { ...chunk, explored: [0, 0] } },
      }).success,
    ).toBe(false);
    expect(
      worldSchema.safeParse({
        ...world,
        chunks: {
          '0,0': {
            ...chunk,
            deposits: [{ ...chunk.deposits[0], remainingQuantity: 100000 }],
          },
        },
      }).success,
    ).toBe(false);
  });
  it('limits loaded terrain to bounded world chunks at any camera target', () => {
    for (const { x, y } of [
      { x: 0, y: 0 },
      { x: 256, y: 256 },
      { x: 511, y: 511 },
    ]) {
      const chunks = terrainWindow(x, y, 3);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.length).toBeLessThanOrEqual(49);
      expect(
        new Set(chunks.map((chunk) => chunkKey(chunk.x, chunk.z))).size,
      ).toBe(chunks.length);
      expect(
        chunks.some(
          (chunk) =>
            chunk.x === Math.floor(x / CHUNK_SIZE) &&
            chunk.z === Math.floor(y / CHUNK_SIZE) &&
            chunk.stride === 1,
        ),
      ).toBe(true);
      expect(
        chunks.every(
          (chunk) =>
            chunk.x >= 0 && chunk.x < 32 && chunk.z >= 0 && chunk.z < 32,
        ),
      ).toBe(true);
    }
  });
  it('supports long world-spanning paths and keeps paused/running simulation independent of terrain size', () => {
    const path = walkingPath(
      { buildings: [], infrastructure: [] },
      { x: 0, y: 0 },
      { x: 511, y: 511 },
    );
    expect(path).toHaveLength(1022);
    expect(path?.at(-1)).toEqual({ x: 511, y: 511 });
    let previous = { x: 0, y: 0 };
    for (const next of path!) {
      expect(
        Math.abs(next.x - previous.x) + Math.abs(next.y - previous.y),
      ).toBe(1);
      previous = next;
    }
    const state = deployColony(newGame()),
      expanded: ColonyState = {
        ...state,
        world: revealArea(
          state.world,
          state.seed,
          { x: 0, y: 0 },
          { x: 511, y: 511 },
        ),
      };
    const a = step(state),
      b = step(expanded);
    expect(b.inventory).toEqual(a.inventory);
    expect(b.residents).toEqual(a.residents);
    expect(b.world).toBe(expanded.world);
  });
});
