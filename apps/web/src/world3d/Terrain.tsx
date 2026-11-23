import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  CHUNK_SIZE,
  chunkKey,
  hash,
  terrainAt,
  WORLD_SIZE,
  type Tile,
  type WorldState,
} from '@mars/simulation';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Object3D,
} from 'three';
import { elevation, groundShade, surfaceAt } from './heightmap';

const basalt = new Color(0x8d4d3f);
const dust = new Color(0xc27d5a);
const polarStone = new Color(0x9e9b8c);

type ChunkProps = {
  seed: number;
  landing: Tile;
  x: number;
  z: number;
  stride: number;
  north: number;
  east: number;
  south: number;
  west: number;
  explored?: number[];
  rocks: boolean;
};

function chunkGeometry({
  seed,
  landing,
  x,
  z,
  stride,
  north,
  east,
  south,
  west,
  explored,
}: Omit<ChunkProps, 'rocks'>) {
  const startX = x * CHUNK_SIZE;
  const startZ = z * CHUNK_SIZE;
  const positions: number[] = [];
  const colors: number[] = [];
  const visible = new Set(explored);
  let light = 1;
  const samples = CHUNK_SIZE / stride;
  const points = Array.from({ length: samples + 1 }, (_, row) =>
    Array.from({ length: samples + 1 }, (_, column) => {
      const px = startX + column * stride - 0.5;
      const pz = startZ + row * stride - 0.5;
      const tile = terrainAt(
        seed,
        Math.max(0, Math.min(WORLD_SIZE - 1, Math.round(px))),
        Math.max(0, Math.min(WORLD_SIZE - 1, Math.round(pz))),
      );
      const color = basalt.clone().lerp(dust, groundShade(seed, px, pz));
      if (tile.region === 'ice-bearing') color.lerp(polarStone, 0.25);
      const edgeStride = Math.max(
        stride,
        row === 0 ? north : 0,
        column === samples ? east : 0,
        row === samples ? south : 0,
        column === 0 ? west : 0,
      );
      // A detailed boundary follows the coarser neighbor's mesh edge.
      const height =
        edgeStride === stride
          ? elevation(seed, px, pz, landing)
          : surfaceAt(seed, px, pz, landing, edgeStride);
      return {
        position: [px, height, pz] as const,
        color,
      };
    }),
  );
  function point({ position, color }: (typeof points)[number][number]) {
    positions.push(...position);
    colors.push(color.r * light, color.g * light, color.b * light);
  }
  for (let row = 0; row < samples; row++)
    for (let column = 0; column < samples; column++) {
      const i = column * stride;
      const j = row * stride;
      light = visible.has(j * CHUNK_SIZE + i) ? 1 : 0.72;
      const a = points[row]![column]!;
      const b = points[row]![column + 1]!;
      const c = points[row + 1]![column]!;
      const d = points[row + 1]![column + 1]!;
      for (const vertex of [a, c, b, b, c, d]) point(vertex);

      // Skirts close only the perimeter of the loaded terrain.
      light *= 0.83;
      const skirt = (p: typeof a, q: typeof a) => {
        function lower(point: typeof a) {
          const [x, y, z] = point.position;
          return { ...point, position: [x, y - 2.4, z] as const };
        }
        for (const vertex of [p, q, lower(p), lower(p), q, lower(q)])
          point(vertex);
      };
      if (!north && row === 0) skirt(a, b);
      if (!east && column === samples - 1) skirt(b, d);
      if (!south && row === samples - 1) skirt(d, c);
      if (!west && column === 0) skirt(c, a);
    }
  const terrain = new BufferGeometry();
  terrain.setAttribute('position', new Float32BufferAttribute(positions, 3));
  terrain.setAttribute('color', new Float32BufferAttribute(colors, 3));
  terrain.computeVertexNormals();
  return terrain;
}

const TerrainChunk = memo(function TerrainChunk(props: ChunkProps) {
  const {
    seed,
    landing,
    x,
    z,
    stride,
    north,
    east,
    south,
    west,
    explored,
    rocks,
  } = props;
  const geometry = useMemo(
    () =>
      chunkGeometry({
        seed,
        landing,
        x,
        z,
        stride,
        north,
        east,
        south,
        west,
        explored,
      }),
    [seed, landing, x, z, stride, north, east, south, west, explored],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const instances = useMemo(() => {
    if (!rocks || stride !== 1) return [];
    return (explored ?? []).flatMap((index) => {
      const px = x * CHUNK_SIZE + (index % CHUNK_SIZE);
      const pz = z * CHUNK_SIZE + Math.floor(index / CHUNK_SIZE);
      if (Math.max(Math.abs(px - landing.x), Math.abs(pz - landing.y)) < 9)
        return [];
      const tile = terrainAt(seed, px, pz);
      if (tile.decoration !== 'rock' && tile.decoration !== 'boulder')
        return [];
      const size =
        tile.decoration === 'boulder'
          ? tile.region === 'rocky-highlands'
            ? 0.58
            : 0.34
          : 0.19;
      return {
        x: px,
        y: surfaceAt(seed, px, pz, landing),
        z: pz,
        size,
        angle: hash(seed, px, pz) % 7,
      };
    });
  }, [explored, landing, rocks, seed, stride, x, z]);
  const rockMesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = rockMesh.current;
    if (!mesh) return;
    const transform = new Object3D();
    instances.forEach(({ x, y, z, size, angle }, index) => {
      transform.position.set(x, y + size * 0.18, z);
      transform.rotation.set(0.18, angle, 0);
      transform.scale.set(size, size * 0.65, size * 0.8);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances]);
  return (
    <>
      <mesh geometry={geometry} userData={{ terrain: true }} receiveShadow>
        <meshStandardMaterial vertexColors roughness={1} />
      </mesh>
      {instances.length > 0 && (
        <instancedMesh
          ref={rockMesh}
          args={[undefined, undefined, instances.length]}
        >
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#674b41" roughness={0.94} />
        </instancedMesh>
      )}
    </>
  );
});

export function Terrain({
  terrain,
  chunks,
  world,
  seed,
  landing,
  rocks,
}: {
  terrain: React.RefObject<Group | null>;
  chunks: { x: number; z: number; stride: number }[];
  world?: WorldState;
  seed: number;
  landing: Tile;
  rocks: boolean;
}) {
  const resolutions = useMemo(
    () => new Map(chunks.map(({ x, z, stride }) => [chunkKey(x, z), stride])),
    [chunks],
  );
  return (
    <group ref={terrain}>
      {chunks.map(({ x, z, stride }) => (
        <TerrainChunk
          key={chunkKey(x, z)}
          x={x}
          z={z}
          stride={stride}
          north={resolutions.get(chunkKey(x, z - 1)) ?? 0}
          east={resolutions.get(chunkKey(x + 1, z)) ?? 0}
          south={resolutions.get(chunkKey(x, z + 1)) ?? 0}
          west={resolutions.get(chunkKey(x - 1, z)) ?? 0}
          explored={world?.chunks[chunkKey(x, z)]?.explored}
          seed={seed}
          landing={landing}
          rocks={rocks}
        />
      ))}
    </group>
  );
}
