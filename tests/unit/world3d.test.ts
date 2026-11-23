import { expect, it } from 'vitest';
import {
  deployColony,
  newGame,
  segmentId,
  type Segment,
} from '../../packages/simulation/src/index.js';
import {
  craterAt,
  elevation,
  foundationRange,
  placement3D,
  surfaceAt,
  terrainWindow,
  worldTile,
} from '../../apps/web/src/world3d/terrain.js';
import { infrastructureLinks } from '../../apps/web/src/world3d/infrastructure.js';

it('generates repeatable heights, a depressed crater and smooth starter grades', () => {
  const land = { x: 256, y: 256 };
  const crater = craterAt(5, 4, 4);
  const center = elevation(5, crater.x, crater.z, land);
  expect(elevation(5, crater.x, crater.z, land)).toBe(center);
  expect(elevation(6, crater.x, crater.z, land)).not.toBe(center);
  const rim = [
    [crater.x + crater.radius, crater.z],
    [crater.x - crater.radius, crater.z],
    [crater.x, crater.z + crater.radius],
    [crater.x, crater.z - crater.radius],
  ].map(([x, z]) => elevation(5, x!, z!, land));
  expect(rim.reduce((sum, y) => sum + y, 0) / rim.length).toBeGreaterThan(
    center + 1,
  );
  expect(foundationRange(5, land, land, 3, 3).steepest).toBeLessThan(0.6);
});

it('interpolates along the terrain mesh diagonal and snaps from X/Z to tile X/Y', () => {
  const land = { x: 256, y: 256 };
  const start = elevation(7, 21.5, 20.5, land);
  const end = elevation(7, 20.5, 21.5, land);
  expect(surfaceAt(7, 21, 21, land)).toBeCloseTo((start + end) / 2);
  expect(worldTile(21.49, 21.51)).toEqual({ x: 21, y: 22 });
  expect(worldTile(511.5, 3)).toBeNull();
  expect(worldTile(-0.51, 3)).toBeNull();
});

it('bounds the number of terrain chunks and coarsens geometry by distance', () => {
  const chunks = terrainWindow(256, 256, 3);
  expect(chunks).toHaveLength(49);
  expect(chunks.filter((c) => c.stride === 1)).toHaveLength(9);
  expect(chunks.filter((c) => c.stride === 4)).toHaveLength(24);
  expect(terrainWindow(511, 511, 2)).toHaveLength(9);
});

it('runs the existing collision validation before the 3D grade check', () => {
  const colony = deployColony(newGame(5));
  expect(placement3D(colony, 'housing', colony.landingZone)).toEqual({
    valid: false,
    reason: 'Building footprint is occupied',
  });
});

it('draws a live utility edge only between usable same-channel cardinal neighbors', () => {
  const colony = deployColony(newGame(5));
  const segment = (
    x: number,
    y: number,
    type: Segment['type'],
    enabled = true,
  ): Segment => ({
    id: segmentId(type, { x, y }),
    x,
    y,
    type,
    enabled,
    health: 100,
  });
  const base = segment(120, 120, 'power');
  const neighbor = segment(121, 120, 'power');
  const diagonal = segment(119, 119, 'power');
  const otherChannel = segment(119, 120, 'oxygen');
  const blocked = segment(120, 121, 'power', false);
  const result = infrastructureLinks(
    {
      ...colony,
      buildings: [],
      networks: [],
      infrastructure: [base, neighbor, diagonal, otherChannel, blocked],
    },
    () => true,
    'normal',
    null,
  );
  expect(result).toHaveLength(7);
  const edges = result.filter(
    (link) => Math.abs(link.to[0] - link.from[0]) > 0.4,
  );
  expect(edges).toHaveLength(2);
  expect(edges.every((edge) => edge.type === 'power')).toBe(true);
  expect(result.some((link) => link.color === 0xde6b4e)).toBe(true);
});
