import {
  CHUNK_SIZE,
  footprint,
  placement,
  WORLD_SIZE,
  type BuildingType,
  type ColonyState,
  type Tile,
} from '@mars/simulation';

import { elevation } from './heightmap';
export { craterAt, elevation, surfaceAt } from './heightmap';

export function worldTile(x: number, z: number): Tile | null {
  const tile = { x: Math.floor(x + 0.5), y: Math.floor(z + 0.5) };
  return tile.x >= 0 &&
    tile.x < WORLD_SIZE &&
    tile.y >= 0 &&
    tile.y < WORLD_SIZE
    ? tile
    : null;
}

export function foundationRange(
  seed: number,
  landing: Tile,
  tile: Tile,
  width: number,
  height: number,
) {
  let low = Infinity;
  let high = -Infinity;
  let steepest = 0;
  const corners = Array.from({ length: height + 1 }, (_, row) =>
    Array.from({ length: width + 1 }, (_, column) =>
      elevation(seed, tile.x + column - 0.5, tile.y + row - 0.5, landing),
    ),
  );
  for (let row = 0; row <= height; row++) {
    for (let column = 0; column <= width; column++) {
      const a = corners[row]![column]!;
      low = Math.min(low, a);
      high = Math.max(high, a);
      if (row < height && column < width) {
        const b = corners[row]![column + 1]!;
        const c = corners[row + 1]![column]!;
        const d = corners[row + 1]![column + 1]!;
        steepest = Math.max(
          steepest,
          Math.hypot(b - a, c - a),
          Math.hypot(d - c, d - b),
        );
      }
    }
  }
  return { low, high, steepest };
}

export function placement3D(
  state: ColonyState,
  type: BuildingType,
  tile: Tile,
) {
  const check = placement(state, type, tile);
  if (!check.valid) return check;
  const cells = footprint(type, tile, state);
  const last = cells[cells.length - 1]!;
  const range = foundationRange(
    state.seed,
    state.landingZone,
    tile,
    last.x - tile.x + 1,
    last.y - tile.y + 1,
  );
  return range.steepest > 0.6
    ? { valid: false, reason: 'Terrain is too steep for a standard foundation' }
    : check;
}

export function terrainWindow(x: number, z: number, radius: number) {
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkZ = Math.floor(z / CHUNK_SIZE);
  const chunks: { x: number; z: number; stride: number }[] = [];
  const limit = WORLD_SIZE / CHUNK_SIZE;
  for (
    let j = Math.max(0, chunkZ - radius);
    j <= Math.min(limit - 1, chunkZ + radius);
    j++
  ) {
    for (
      let i = Math.max(0, chunkX - radius);
      i <= Math.min(limit - 1, chunkX + radius);
      i++
    ) {
      const distance = Math.max(Math.abs(i - chunkX), Math.abs(j - chunkZ));
      chunks.push({
        x: i,
        z: j,
        stride: distance <= 1 ? 1 : distance === 2 ? 2 : 4,
      });
    }
  }
  return chunks;
}
