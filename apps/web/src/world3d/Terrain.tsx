import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  CHUNK_SIZE,
  chunkKey,
  hash,
  terrainAt,
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
import { elevation, surfaceAt } from './terrain';

const terrainColors = {
  dust: [0xb46a53, 0xb76c51, 0xb16a53],
  sand: [0xbd7757, 0xbe7658, 0xbb765a],
  basalt: [0x965c50, 0x9a6052, 0x985f52],
};

type ChunkProps = {
  seed: number;
  landing: Tile;
  x: number;
  z: number;
  stride: number;
  explored?: number[];
  rocks: boolean;
};

function chunkGeometry({
  seed,
  landing,
  x,
  z,
  stride,
  explored,
}: Omit<ChunkProps, 'rocks'>) {
  const startX = x * CHUNK_SIZE;
  const startZ = z * CHUNK_SIZE;
  const positions: number[] = [];
  const colors: number[] = [];
  const visible = new Set(explored);
  const color = new Color();
  const polarStone = new Color(0x9e9b8c);
  const samples = CHUNK_SIZE / stride;
  const points = Array.from({ length: samples + 1 }, (_, row) =>
    Array.from({ length: samples + 1 }, (_, column) => {
      const px = startX + column * stride - 0.5;
      const pz = startZ + row * stride - 0.5;
      return [px, elevation(seed, px, pz, landing), pz] as const;
    }),
  );
  function point(value: readonly number[]) {
    positions.push(...value);
    colors.push(color.r, color.g, color.b);
  }
  for (let row = 0; row < samples; row++)
    for (let column = 0; column < samples; column++) {
      const i = column * stride;
      const j = row * stride;
      const tile = terrainAt(seed, startX + i, startZ + j);
      color.setHex(terrainColors[tile.texture][tile.shade]!);
      if (tile.region === 'ice-bearing') color.lerp(polarStone, 0.25);
      if (!visible.has(j * CHUNK_SIZE + i)) color.multiplyScalar(0.63);
      const a = points[row]![column]!;
      const b = points[row]![column + 1]!;
      const c = points[row + 1]![column]!;
      const d = points[row + 1]![column + 1]!;
      for (const vertex of [a, c, b, b, c, d]) point(vertex);

      // Vertical skirts hide gaps where adjacent chunks use different sampling rates.
      color.multiplyScalar(0.83);
      const skirt = (
        p: readonly [number, number, number],
        q: readonly [number, number, number],
      ) => {
        const low = ([px, py, pz]: typeof p) => [px, py - 1.8, pz];
        for (const vertex of [p, q, low(p), low(p), q, low(q)]) point(vertex);
      };
      if (row === 0) skirt(a, b);
      if (column === samples - 1) skirt(b, d);
      if (row === samples - 1) skirt(d, c);
      if (column === 0) skirt(c, a);
    }
  const terrain = new BufferGeometry();
  terrain.setAttribute('position', new Float32BufferAttribute(positions, 3));
  terrain.setAttribute('color', new Float32BufferAttribute(colors, 3));
  terrain.computeVertexNormals();
  return terrain;
}

const TerrainChunk = memo(function TerrainChunk(props: ChunkProps) {
  const { seed, landing, x, z, stride, explored, rocks } = props;
  const geometry = useMemo(
    () => chunkGeometry({ seed, landing, x, z, stride, explored }),
    [seed, landing, x, z, stride, explored],
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
      const size = tile.decoration === 'boulder' ? 0.34 : 0.19;
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
  return (
    <group ref={terrain}>
      {chunks.map(({ x, z, stride }) => (
        <TerrainChunk
          key={chunkKey(x, z)}
          x={x}
          z={z}
          stride={stride}
          explored={world?.chunks[chunkKey(x, z)]?.explored}
          seed={seed}
          landing={landing}
          rocks={rocks}
        />
      ))}
    </group>
  );
}
