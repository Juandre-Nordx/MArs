export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 38;
export const HALF_TILE_WIDTH = TILE_WIDTH / 2;
export const HALF_TILE_HEIGHT = TILE_HEIGHT / 2;
export { WORLD_SIZE } from '../../../packages/simulation/src/dimensions.js';
export function tileToWorld(x: number, y: number) {
  return { x: (x - y) * HALF_TILE_WIDTH, y: (x + y) * HALF_TILE_HEIGHT };
}
export function worldToTile(x: number, y: number) {
  return {
    x: Math.round(x / TILE_WIDTH + y / TILE_HEIGHT),
    y: Math.round(y / TILE_HEIGHT - x / TILE_WIDTH),
  };
}

export function footprintCorners(
  x: number,
  y: number,
  width: number,
  height: number,
  inset = 0,
) {
  const left = x - 0.5 + inset;
  const right = x + width - 0.5 - inset;
  const top = y - 0.5 + inset;
  const bottom = y + height - 0.5 - inset;
  return [
    tileToWorld(left, top),
    tileToWorld(right, top),
    tileToWorld(right, bottom),
    tileToWorld(left, bottom),
  ] as const;
}
