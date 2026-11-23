import {
  CHUNK_SIZE,
  footprint,
  hash,
  placement,
  WORLD_SIZE,
  type BuildingType,
  type ColonyState,
  type Tile,
} from '@mars/simulation';

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function noise(seed: number, x: number, z: number, size: number) {
  const a = Math.floor(x / size);
  const b = Math.floor(z / size);
  const u = smooth(x / size - a);
  const v = smooth(z / size - b);
  const value = (i: number, j: number) => hash(seed, i, j) / 0xffffffff;
  return lerp(
    lerp(value(a, b), value(a + 1, b), u),
    lerp(value(a, b + 1), value(a + 1, b + 1), u),
    v,
  );
}

const basinSize = 32;
export function craterAt(seed: number, x: number, z: number) {
  const value = hash(seed + 91, x, z);
  return {
    x: x * basinSize + 12 + (value % 9),
    z: z * basinSize + 12 + ((value >>> 8) % 9),
    radius: 5 + ((value >>> 16) % 8),
    depth: 1.5 + ((value >>> 24) % 5) * 0.35,
  };
}

export function elevation(seed: number, x: number, z: number, landing: Tile) {
  const strata = noise(seed + 37, x, z, 42);
  const ridge = Math.max(0, (strata - 0.56) * 2);
  let height =
    (noise(seed, x, z, 33) - 0.5) * 6 +
    (noise(seed + 1, x, z, 9) - 0.5) * (0.6 + ridge * 3) +
    ridge * 6;
  const cx = Math.floor(x / basinSize);
  const cz = Math.floor(z / basinSize);
  for (let i = cx - 1; i <= cx + 1; i++) {
    for (let j = cz - 1; j <= cz + 1; j++) {
      const crater = craterAt(seed, i, j);
      const distance = Math.hypot(x - crater.x, z - crater.z) / crater.radius;
      if (distance < 1.3) {
        const floor = 1 - smooth(Math.min(1, distance));
        const rim = Math.max(0, 1 - Math.abs(distance - 1) / 0.3);
        height += crater.depth * (rim * 0.28 - floor);
      }
    }
  }
  const landingDistance = Math.max(
    Math.abs(x - landing.x),
    Math.abs(z - landing.y),
  );
  return (
    height *
    lerp(0.16, 1, smooth(Math.min(1, Math.max(0, (landingDistance - 8) / 12))))
  );
}

// The full-resolution mesh uses the same diagonal in every tile.
export function surfaceAt(seed: number, x: number, z: number, landing: Tile) {
  const left = Math.floor(x + 0.5) - 0.5;
  const back = Math.floor(z + 0.5) - 0.5;
  const u = x - left;
  const v = z - back;
  const b = elevation(seed, left + 1, back, landing);
  const c = elevation(seed, left, back + 1, landing);
  if (u + v <= 1) {
    const a = elevation(seed, left, back, landing);
    return a + (b - a) * u + (c - a) * v;
  }
  const d = elevation(seed, left + 1, back + 1, landing);
  return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

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
  for (let j = 0; j <= height; j++) {
    for (let i = 0; i <= width; i++) {
      const x = tile.x + i - 0.5;
      const z = tile.y + j - 0.5;
      const value = elevation(seed, x, z, landing);
      low = Math.min(low, value);
      high = Math.max(high, value);
      if (i < width)
        steepest = Math.max(
          steepest,
          Math.abs(value - elevation(seed, x + 1, z, landing)),
        );
      if (j < height)
        steepest = Math.max(
          steepest,
          Math.abs(value - elevation(seed, x, z + 1, landing)),
        );
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
