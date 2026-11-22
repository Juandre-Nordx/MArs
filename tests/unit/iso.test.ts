import { expect, it } from 'vitest';
import { spritePlacement } from '../../apps/web/src/sprite-placement.js';
import { WORLD_SIZE as SIMULATION_WORLD_SIZE } from '../../packages/simulation/src/index.js';
import {
  tileToWorld,
  worldToTile,
  WORLD_SIZE,
} from '../../apps/web/src/iso.js';
it('keeps rendering and simulation map dimensions synchronized', () => {
  expect(WORLD_SIZE).toBe(SIMULATION_WORLD_SIZE);
});
it('round trips every tile center through the isometric projection', () => {
  for (let x = 0; x < WORLD_SIZE; x++)
    for (let y = 0; y < WORLD_SIZE; y++) {
      const point = tileToWorld(x, y);
      expect(worldToTile(point.x, point.y)).toEqual({ x, y });
    }
});

it('anchors uploaded sprites to the front corner and scales them to the footprint width', () => {
  const art = { scale: 1, spriteAlignment: 'footprint-front' } as const;
  expect(spritePlacement({ width: 2, height: 2 }, art)).toEqual({
    x: 0,
    y: 48,
    width: 128,
  });
  expect(spritePlacement({ width: 4, height: 3 }, art)).toEqual({
    x: 32,
    y: 96,
    width: 224,
  });
  expect(
    spritePlacement({ width: 1, height: 1 }, { ...art, scale: 1.5 }),
  ).toEqual({ x: 0, y: 16, width: 96 });
});

it('keeps the original placement for previously published sprite settings', () => {
  const footprint = { width: 4, height: 3 };
  const original = { x: 0, y: 0, width: 96 };
  expect(spritePlacement(footprint, { scale: 0.75 })).toEqual(original);
  expect(
    spritePlacement(footprint, { scale: 0.75, spriteAlignment: 'tile-center' }),
  ).toEqual(original);
});
