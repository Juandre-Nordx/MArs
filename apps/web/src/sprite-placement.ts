import { TILE_HEIGHT, TILE_WIDTH, tileToWorld } from './iso';

type Footprint = { width: number; height: number };

export function spritePlacement(
  footprint: Footprint,
  art: {
    id?: string;
    scale: number;
    spriteAlignment?: 'tile-center' | 'footprint-front';
  },
  courtyard = false,
) {
  const footprintAligned =
    art.spriteAlignment === 'footprint-front' ||
    (courtyard && art.spriteAlignment === undefined);
  if (!footprintAligned) return { x: 0, y: 0, width: 128 * art.scale };

  const last = tileToWorld(footprint.width - 1, footprint.height - 1);
  const margin = courtyard ? (art.id === 'housing' ? 0.8 : 0.92) : 1;
  return {
    x: last.x,
    y: last.y + TILE_HEIGHT / 2,
    width:
      ((footprint.width + footprint.height) * TILE_WIDTH * art.scale * margin) /
      2,
  };
}
