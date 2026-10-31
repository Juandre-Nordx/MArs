import { expect, it } from 'vitest';
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
