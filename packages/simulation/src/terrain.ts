import { WORLD_SIZE, CHUNK_SIZE, LEGACY_WORLD_SIZE } from './catalog.js';
export type Tile = { x: number; y: number };
export type TerrainTile = Tile & {
  texture: 'dust' | 'sand' | 'basalt';
  decoration: 'none' | 'rock' | 'boulder' | 'ripples' | 'crater' | 'ice';
  shade: number;
  region: 'plains' | 'crater-fields' | 'rocky-highlands' | 'ice-bearing';
};
export function hash(seed: number, x: number, y: number): number {
  let n =
    (seed ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return (n ^ (n >>> 16)) >>> 0;
}
export function terrainAt(seed: number, x: number, y: number): TerrainTile {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= WORLD_SIZE ||
    y >= WORLD_SIZE
  )
    throw new Error('Terrain outside world');
  const h = hash(seed, x, y);
  const region =
    x < LEGACY_WORLD_SIZE && y < LEGACY_WORLD_SIZE
      ? 'plains'
      : (
          ['plains', 'crater-fields', 'rocky-highlands', 'ice-bearing'] as const
        )[hash(seed + 71, Math.floor(x / 48), Math.floor(y / 48)) % 4]!;
  return {
    x,
    y,
    region,
    texture: h % 7 === 0 ? 'basalt' : h % 3 === 0 ? 'sand' : 'dust',
    decoration:
      region === 'crater-fields' && h % 5 === 0
        ? 'crater'
        : region === 'ice-bearing' && h % 3 === 0
          ? 'ice'
          : region === 'rocky-highlands' && h % 3 === 0
            ? 'boulder'
            : h % 17 === 0
              ? 'boulder'
              : h % 7 === 0
                ? 'rock'
                : h % 4 === 0
                  ? 'ripples'
                  : 'none',
    shade: h % 3,
  };
}
export function generateChunk(
  seed: number,
  cx: number,
  cy: number,
): TerrainTile[] {
  return Array.from({ length: CHUNK_SIZE * CHUNK_SIZE }, (_, i) =>
    terrainAt(
      seed,
      cx * CHUNK_SIZE + (i % CHUNK_SIZE),
      cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE),
    ),
  );
}
// Compatibility helper for the original landing patch. The renderer uses chunks.
export function generateTerrain(seed: number): TerrainTile[] {
  return Array.from({ length: LEGACY_WORLD_SIZE * LEGACY_WORLD_SIZE }, (_, i) =>
    terrainAt(seed, i % LEGACY_WORLD_SIZE, Math.floor(i / LEGACY_WORLD_SIZE)),
  );
}
// All Stage 2 terrain is traversable. Surface rocks are purely decorative.
export function findLandingZone(seed: number): Tile {
  return {
    x: 9 + (hash(seed, 0, 0) % 3) - 1,
    y: 9 + (hash(seed, 1, 0) % 3) - 1,
  };
}
