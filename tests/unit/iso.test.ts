import { expect, it } from 'vitest';
import { spritePlacement } from '../../apps/web/src/sprite-placement.js';
import { WORLD_SIZE as SIMULATION_WORLD_SIZE } from '../../packages/simulation/src/index.js';
import {
  footprintCorners,
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
    y: 57,
    width: 128,
  });
  expect(spritePlacement({ width: 4, height: 3 }, art)).toEqual({
    x: 32,
    y: 114,
    width: 224,
  });
  expect(
    spritePlacement({ width: 1, height: 1 }, { ...art, scale: 1.5 }),
  ).toEqual({ x: 0, y: 19, width: 96 });
});

it('keeps the original placement for previously published sprite settings', () => {
  const footprint = { width: 4, height: 3 };
  const original = { x: 0, y: 0, width: 96 };
  expect(spritePlacement(footprint, { scale: 0.75 })).toEqual(original);
  expect(
    spritePlacement(footprint, { scale: 0.75, spriteAlignment: 'tile-center' }),
  ).toEqual(original);
});

it('fits new colony artwork to the footprint with space around habitats', () => {
  expect(
    spritePlacement({ width: 1, height: 1 }, { id: 'housing', scale: 1 }, true),
  ).toEqual({ x: 0, y: 19, width: 51.2 });
  const wide = spritePlacement(
    { width: 3, height: 2 },
    { id: 'farm', scale: 1.25 },
    true,
  );
  expect(wide).toMatchObject({ x: 32, y: 76 });
  expect(wide.width).toBeCloseTo(180);
  expect(
    spritePlacement(
      { width: 2, height: 2 },
      { scale: 1, spriteAlignment: 'tile-center' },
      true,
    ),
  ).toEqual({ x: 0, y: 0, width: 128 });
});

it('joins neighboring footprints along the same projected edge', () => {
  const [, right, front] = footprintCorners(4, 8, 3, 2);
  const [back, , , left] = footprintCorners(7, 8, 1, 2);
  expect(right).toEqual(back);
  expect(front).toEqual(left);
});

it('fits a centered anchor within a rectangular plot and keeps utility tanks compact', () => {
  const art = { scale: 1, anchor: { x: 0.5 } };
  const farm = spritePlacement(
    { width: 3, height: 2 },
    { ...art, id: 'farm' },
    true,
  );
  expect(farm.width).toBeCloseTo(115.2);

  const tile = { width: 1, height: 1 };
  const tank = spritePlacement(tile, { ...art, id: 'water-tank' }, true);
  const habitat = spritePlacement(tile, { ...art, id: 'housing' }, true);
  expect(tank.width).toBeCloseTo(40.96);
  expect(tank.width).toBeLessThan(habitat.width);
});
