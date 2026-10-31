export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;
export const WORLD_SIZE = 20;
export function tileToWorld(x: number, y: number) {
  return { x: ((x - y) * TILE_WIDTH) / 2, y: ((x + y) * TILE_HEIGHT) / 2 };
}
export function worldToTile(x: number, y: number) {
  return {
    x: Math.round(x / TILE_WIDTH + y / TILE_HEIGHT),
    y: Math.round(y / TILE_HEIGHT - x / TILE_WIDTH),
  };
}
