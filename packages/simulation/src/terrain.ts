import { WORLD_SIZE } from './catalog.js';
export type Tile = { x: number; y: number };
export type TerrainTile = Tile & {
  texture: 'dust' | 'sand' | 'basalt';
  decoration: 'none' | 'rock' | 'boulder' | 'ripples';
  shade: number;
};
export function hash(seed: number, x: number, y: number): number {
  let n =
    (seed ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return (n ^ (n >>> 16)) >>> 0;
}
export function generateTerrain(seed: number): TerrainTile[] {
  return Array.from({ length: WORLD_SIZE * WORLD_SIZE }, (_, index) => {
    const x = index % WORLD_SIZE;
    const y = Math.floor(index / WORLD_SIZE);
    const h = hash(seed, x, y);
    return {
      x,
      y,
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
    };
  });
}
// All Stage 2 terrain is traversable. Surface rocks are purely decorative.
export function findLandingZone(seed: number): Tile {
  return {
    x: 9 + (hash(seed, 0, 0) % 3) - 1,
    y: 9 + (hash(seed, 1, 0) % 3) - 1,
  };
}
