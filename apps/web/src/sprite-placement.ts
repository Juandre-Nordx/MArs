import { TILE_HEIGHT, TILE_WIDTH, tileToWorld } from './iso';

type Footprint = { width: number; height: number };

export function spritePlacement(
  footprint: Footprint,
  art: { scale: number; spriteAlignment?: 'tile-center' | 'footprint-front' },
) {
  if (art.spriteAlignment !== 'footprint-front')
    return { x: 0, y: 0, width: 128 * art.scale };

  const last = tileToWorld(footprint.width - 1, footprint.height - 1);
  return {
    x: last.x,
    y: last.y + TILE_HEIGHT / 2,
    width: ((footprint.width + footprint.height) * TILE_WIDTH * art.scale) / 2,
  };
}
