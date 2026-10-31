import { expect, it } from 'vitest';
import {
  tileToWorld,
  worldToTile,
  WORLD_SIZE,
} from '../../apps/web/src/iso.js';
it('round trips every tile center through the isometric projection', () => {
  for (let x = 0; x < WORLD_SIZE; x++)
    for (let y = 0; y < WORLD_SIZE; y++) {
      const point = tileToWorld(x, y);
      expect(worldToTile(point.x, point.y)).toEqual({ x, y });
    }
});
