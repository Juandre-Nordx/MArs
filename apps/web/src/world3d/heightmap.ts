import {
  hash,
  type Tile,
} from '../../../../packages/simulation/src/terrain.js';

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

export function groundShade(seed: number, x: number, z: number) {
  return noise(seed + 17, x, z, 19) * 0.7 + noise(seed + 29, x, z, 4) * 0.3;
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
    ridge * 6 +
    Math.pow(Math.max(0, (strata - 0.62) / 0.38), 1.7) * 11;
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
export function surfaceAt(
  seed: number,
  x: number,
  z: number,
  landing: Tile,
  stride = 1,
) {
  const left = Math.floor((x + 0.5) / stride) * stride - 0.5;
  const back = Math.floor((z + 0.5) / stride) * stride - 0.5;
  const u = (x - left) / stride;
  const v = (z - back) / stride;
  const b = elevation(seed, left + stride, back, landing);
  const c = elevation(seed, left, back + stride, landing);
  if (u + v <= 1) {
    const a = elevation(seed, left, back, landing);
    return a + (b - a) * u + (c - a) * v;
  }
  const d = elevation(seed, left + stride, back + stride, landing);
  return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
