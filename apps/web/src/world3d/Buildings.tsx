import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import {
  type BuildingModel,
  type BuildingType,
  type ModelState,
  type Tile,
} from '@mars/simulation';
import { UploadedModel } from './UploadedModel';
import { foundationRange, surfaceAt } from './terrain';

type Point = [number, number, number];
type Material = { color: string; opacity: number };
type ModelProps = {
  type: BuildingType;
  width: number;
  depth: number;
  tint?: string;
  operating?: boolean;
};
const cream = '#e3c7a0';
const graphite = '#44484a';
const turquoise = '#427f83';
const copper = '#d48644';
const steel = '#767b73';
const glass = '#204653';

function Material({ color, opacity }: Material) {
  return (
    <meshStandardMaterial
      color={color}
      transparent={opacity < 1}
      opacity={opacity}
      depthWrite={opacity === 1}
      roughness={0.76}
    />
  );
}

export function Block({
  at,
  size,
  color,
  opacity = 1,
  rotation,
}: {
  at: Point;
  size: Point;
  color: string;
  opacity?: number;
  rotation?: Point;
}) {
  return (
    <mesh
      position={at}
      rotation={rotation}
      castShadow={opacity === 1}
      receiveShadow
    >
      <boxGeometry args={size} />
      <Material color={color} opacity={opacity} />
    </mesh>
  );
}

export function Drum({
  at,
  top,
  bottom = top,
  height,
  color,
  opacity = 1,
  rotation,
  sides = 12,
}: {
  at: Point;
  top: number;
  bottom?: number;
  height: number;
  color: string;
  opacity?: number;
  rotation?: Point;
  sides?: number;
}) {
  return (
    <mesh
      position={at}
      rotation={rotation}
      castShadow={opacity === 1}
      receiveShadow
    >
      <cylinderGeometry args={[top, bottom, height, sides]} />
      <Material color={color} opacity={opacity} />
    </mesh>
  );
}

function Drill({
  color,
  opacity,
  operating,
}: Material & { operating?: boolean }) {
  const head = useRef<Group>(null);
  useFrame((_, delta) => {
    if (head.current && operating) head.current.rotation.y += delta * 3;
  });
  return (
    <group ref={head} position={[0, 0.64, 0]}>
      <Drum
        at={[0, 0, 0]}
        top={0.075}
        bottom={0}
        height={0.52}
        sides={6}
        color={color}
        opacity={opacity}
      />
      <Block
        at={[0, 0.14, 0]}
        size={[0.29, 0.07, 0.08]}
        color={color}
        opacity={opacity}
      />
    </group>
  );
}

export function ProceduralBuilding({
  type,
  width,
  depth,
  tint,
  operating,
}: ModelProps) {
  const opacity = tint ? 0.54 : 1;
  const paint = (color: string) => ({ color: tint ?? color, opacity });
  const w = width * 0.84;
  const d = depth * 0.82;
  switch (type) {
    case 'starship':
      return (
        <group>
          <Drum
            at={[0, 0.08, 0]}
            top={0.72}
            height={0.14}
            {...paint(graphite)}
          />
          <Drum
            at={[0, 0.63, 0]}
            top={0.23}
            bottom={0.41}
            height={1.14}
            {...paint(cream)}
          />
          <Drum at={[0, 1.18, 0]} top={0.23} height={0.15} {...paint(glass)} />
          <Drum
            at={[0, 1.46, 0]}
            top={0.035}
            bottom={0.23}
            height={0.42}
            {...paint(cream)}
          />
          {[-1, 1].map((side) => (
            <Block
              key={side}
              at={[side * 0.34, 0.39, 0]}
              size={[0.14, 0.58, 0.55]}
              rotation={[0, 0, side * 0.36]}
              {...paint(copper)}
            />
          ))}
        </group>
      );
    case 'housing':
      return (
        <group>
          <Block
            at={[0, 0.16, 0]}
            size={[w, 0.28, d * 0.82]}
            {...paint(graphite)}
          />
          <Drum
            at={[0, 0.3, 0]}
            top={0.29}
            height={w}
            rotation={[0, 0, Math.PI / 2]}
            {...paint(cream)}
          />
          <Block
            at={[0, 0.38, d * 0.32]}
            size={[w * 0.72, 0.12, 0.09]}
            {...paint(turquoise)}
          />
          <Block
            at={[0.22, 0.18, d * 0.38]}
            size={[0.13, 0.24, 0.09]}
            {...paint(steel)}
          />
        </group>
      );
    case 'solar':
      return (
        <group>
          {Array.from({ length: width * depth }, (_, i) => {
            const x = (i % width) - (width - 1) / 2;
            const z = Math.floor(i / width) - (depth - 1) / 2;
            return (
              <group key={i} position={[x, 0, z]}>
                <Block
                  at={[0, 0.14, 0]}
                  size={[0.11, 0.28, 0.12]}
                  {...paint(steel)}
                />
                <group position={[0, 0.3, 0]} rotation={[-0.33, 0, 0]}>
                  <Block
                    at={[0, 0, 0]}
                    size={[0.91, 0.065, 0.72]}
                    {...paint(steel)}
                  />
                  {[-0.29, 0, 0.29].map((col) => (
                    <Block
                      key={col}
                      at={[col, 0.035, 0]}
                      size={[0.262, 0.025, 0.65]}
                      {...paint('#263f69')}
                    />
                  ))}
                </group>
              </group>
            );
          })}
        </group>
      );
    case 'water-tank':
    case 'oxygen-tank': {
      const color = type === 'water-tank' ? '#4f96be' : '#78abaa';
      return (
        <group>
          <Drum
            at={[0, 0.09, 0]}
            top={0.35}
            height={0.15}
            {...paint(graphite)}
          />
          <Drum at={[0, 0.42, 0]} top={0.3} height={0.59} {...paint(color)} />
          <Drum
            at={[0, 0.74, 0]}
            top={0.19}
            bottom={0.31}
            height={0.11}
            {...paint(cream)}
          />
          <Drum at={[0, 0.29, 0]} top={0.315} height={0.07} {...paint(cream)} />
        </group>
      );
    }
    case 'farm':
      return (
        <group>
          <Block at={[0, 0.13, 0]} size={[w, 0.24, d]} {...paint(cream)} />
          <mesh
            position={[0, 0.27, 0]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow={opacity === 1}
          >
            <cylinderGeometry
              args={[d * 0.44, d * 0.44, w * 0.9, 14, 1, false, 0, Math.PI]}
            />
            <Material {...paint('#65865b')} />
          </mesh>
          {[-0.36, 0, 0.36].map((fraction) => (
            <Drum
              key={fraction}
              at={[w * fraction, 0.28, 0]}
              top={d * 0.45}
              height={0.045}
              rotation={[0, 0, Math.PI / 2]}
              {...paint('#a2a992')}
            />
          ))}
          <Block
            at={[0, 0.25, d * 0.46]}
            size={[0.29, 0.3, 0.09]}
            {...paint(glass)}
          />
        </group>
      );
    case 'ice-drill':
    case 'surface-mine':
    case 'underground-mine':
    case 'deep-mine':
      return (
        <>
          <Block at={[0, 0.12, 0]} size={[w, 0.16, d]} {...paint(graphite)} />
          {[-0.28, 0.28].map((x) => (
            <Block
              key={x}
              at={[x, 0.56, 0]}
              size={[0.09, 0.89, 0.56]}
              {...paint(type === 'ice-drill' ? turquoise : copper)}
            />
          ))}
          <Block
            at={[0, 0.98, 0]}
            size={[0.68, 0.11, 0.59]}
            {...paint(cream)}
          />
          <Drill {...paint(steel)} operating={operating} />
        </>
      );
    default: {
      const equipment =
        type === 'water-recycler' || type === 'oxygen-generator';
      const height = type === 'warehouse' ? 0.69 : 0.49;
      const color = type === 'battery' ? '#ba844e' : cream;
      return (
        <group>
          <Block
            at={[0, height / 2, 0]}
            size={[w, height, d]}
            {...paint(color)}
          />
          <Block
            at={[0, height + 0.03, 0]}
            size={[w * 1.03, 0.09, d * 1.05]}
            {...paint(graphite)}
          />
          {[-0.23, 0, 0.23].map((fraction) => (
            <Block
              key={fraction}
              at={[w * fraction, height * 0.47, d / 2]}
              size={[w * 0.16, height * 0.53, 0.04]}
              {...paint(type === 'warehouse' ? graphite : turquoise)}
            />
          ))}
          {equipment &&
            [-0.27, 0.23].map((fraction) => (
              <Drum
                key={fraction}
                at={[w * fraction, height + 0.19, 0]}
                top={0.11}
                height={0.29}
                {...paint(type === 'water-recycler' ? '#6597a6' : turquoise)}
              />
            ))}
          {type === 'survey-station' && (
            <>
              <Drum
                at={[0.13, height + 0.26, 0]}
                top={0.034}
                height={0.46}
                {...paint(steel)}
              />
              <Drum
                at={[0.13, height + 0.5, 0]}
                top={0.21}
                bottom={0.06}
                height={0.12}
                rotation={[0.46, 0, 0.49]}
                {...paint(cream)}
              />
            </>
          )}
        </group>
      );
    }
  }
}

export function BuildingRenderer({
  type,
  width,
  depth,
  tile,
  seed,
  landing,
  status,
  operating,
  tint,
  animate = false,
  configuredModel,
  health = 100,
  speed = 0,
  modelYaw = 0,
}: ModelProps & {
  tile: Tile;
  seed: number;
  landing: Tile;
  status?: string;
  animate?: boolean;
  configuredModel?: BuildingModel;
  health?: number;
  speed?: number;
  modelYaw?: number;
}) {
  const { low, high } = useMemo(
    () => foundationRange(seed, landing, tile, width, depth),
    [seed, landing, tile.x, tile.y, width, depth],
  );
  const model = useRef<Group>(null);
  const entrance = useRef(animate);
  const progress = useRef(entrance.current ? 0 : 1);
  const [constructing, setConstructing] = useState(animate);
  const visualState: ModelState = constructing
    ? 'construction'
    : health < 100
      ? 'damaged'
      : status === 'running'
        ? 'working'
        : 'idle';
  const fallback = (
    <ProceduralBuilding
      type={type}
      width={width}
      depth={depth}
      tint={tint}
      operating={operating}
    />
  );
  useFrame((_, delta) => {
    if (!model.current || progress.current >= 1) return;
    progress.current = Math.min(
      1,
      progress.current +
        delta * (configuredModel?.animations.construction ? 0.5 : 2),
    );
    model.current.scale.y = 1 - (1 - progress.current) ** 3;
    if (progress.current === 1) setConstructing(false);
  });
  const top = high + 0.1;
  const x = tile.x + (width - 1) / 2;
  const z = tile.y + (depth - 1) / 2;
  const warning =
    status?.startsWith('no-') || status === 'disabled' || status === 'damaged';
  return (
    <group
      position={[x, top, z]}
      userData={tint ? {} : { tile: { x: tile.x, y: tile.y } }}
    >
      <Block
        at={[0, (low - top) / 2, 0]}
        size={[width * 0.94, top - low + 0.06, depth * 0.94]}
        color={tint ?? '#5f5045'}
        opacity={tint ? 0.47 : 1}
      />
      <group
        ref={model}
        rotation={[0, (modelYaw * Math.PI) / 180, 0]}
        scale={[1, entrance.current ? 0.03 : 1, 1]}
      >
        {configuredModel ? (
          <UploadedModel
            model={configuredModel}
            state={visualState}
            playing={!tint && (constructing || speed > 0)}
            tint={tint}
            fallback={fallback}
          />
        ) : (
          fallback
        )}
      </group>
      {!tint && status && (
        <mesh
          position={[width * 0.34, 0.044, depth * 0.38]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.052, 10]} />
          <meshBasicMaterial color={warning ? '#ff8863' : '#8ce6b3'} />
        </mesh>
      )}
    </group>
  );
}

export function TileMarker({
  tile,
  seed,
  landing,
  color,
}: {
  tile: Tile;
  seed: number;
  landing: Tile;
  color: string;
}) {
  const vertices = useMemo(() => {
    const corner = (dx: number, dz: number) => [
      tile.x + dx,
      surfaceAt(seed, tile.x + dx, tile.y + dz, landing) + 0.035,
      tile.y + dz,
    ];
    const a = corner(-0.47, -0.47);
    const b = corner(0.47, -0.47);
    const c = corner(-0.47, 0.47);
    const d = corner(0.47, 0.47);
    return new Float32Array([...a, ...c, ...b, ...b, ...c, ...d]);
  }, [seed, landing, tile.x, tile.y]);
  return (
    <mesh>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[vertices, 3]} />
      </bufferGeometry>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.42}
        depthWrite={false}
      />
    </mesh>
  );
}
