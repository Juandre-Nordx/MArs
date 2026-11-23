import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import { type ColonyState, type Tile } from '@mars/simulation';
import { Block, Drum } from './Buildings';
import { surfaceAt } from './terrain';

type Unit = {
  id: string;
  kind: 'resident' | 'buggy' | 'survey' | 'extractor';
  position: Tile;
  previous?: Tile;
};

function UnitModel({
  unit,
  seed,
  landing,
  speed,
  selected,
}: {
  unit: Unit;
  seed: number;
  landing: Tile;
  speed: number;
  selected: boolean;
}) {
  const root = useRef<Group>(null);
  const position = useRef(unit.previous ?? unit.position);
  const from = useRef(position.current);
  const progress = useRef(1);
  const started = useRef(false);
  const { x, y } = unit.position;
  useEffect(() => {
    from.current = position.current;
    progress.current = started.current ? 0 : 1;
    started.current = true;
  }, [x, y]);
  useFrame((_, delta) => {
    if (!root.current) return;
    progress.current = Math.min(1, progress.current + delta * speed);
    const px = from.current.x + (x - from.current.x) * progress.current;
    const pz = from.current.y + (y - from.current.y) * progress.current;
    position.current = { x: px, y: pz };
    root.current.position.set(
      px,
      surfaceAt(seed, px, pz, landing) + (unit.kind === 'survey' ? 0.73 : 0),
      pz,
    );
    if (from.current.x !== x || from.current.y !== y)
      root.current.rotation.y = Math.atan2(
        x - from.current.x,
        y - from.current.y,
      );
  });
  return (
    <group
      ref={root}
      position={[x, 0, y]}
      userData={unit.kind === 'resident' ? { resident: unit.id } : {}}
    >
      {unit.kind === 'resident' ? (
        <>
          <Block at={[0, 0.24, 0]} size={[0.16, 0.24, 0.11]} color="#e0d8bf" />
          <Drum
            at={[0, 0.42, 0]}
            top={0.08}
            height={0.13}
            color="#d7dbc7"
            sides={8}
          />
          <Block
            at={[0, 0.43, 0.064]}
            size={[0.1, 0.059, 0.05]}
            color="#244f63"
          />
          {[-0.045, 0.045].map((side) => (
            <Block
              key={side}
              at={[side, 0.084, 0]}
              size={[0.057, 0.16, 0.067]}
              color="#9b9f91"
            />
          ))}
        </>
      ) : unit.kind === 'survey' ? (
        <>
          <Block at={[0, 0, 0]} size={[0.3, 0.09, 0.18]} color="#c7d7ca" />
          <Block
            at={[0, 0.035, 0]}
            size={[0.48, 0.024, 0.055]}
            color="#7ab4b2"
          />
        </>
      ) : (
        <>
          <Block
            at={[0, 0.17, 0]}
            size={[0.36, 0.18, 0.55]}
            color={unit.kind === 'buggy' ? '#e4c09e' : '#da9d51'}
          />
          <Block
            at={[0, 0.28, 0.105]}
            size={[0.29, 0.125, 0.18]}
            color="#487381"
          />
          {[-0.19, 0.19].flatMap((side) =>
            [-0.18, 0.18].map((z) => (
              <Drum
                key={`${side},${z}`}
                at={[side, 0.09, z]}
                top={0.086}
                height={0.075}
                rotation={[0, 0, Math.PI / 2]}
                color="#373332"
                sides={8}
              />
            )),
          )}
        </>
      )}
      {selected && (
        <mesh position={[0, 0.028, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.17, 0.21, 16]} />
          <meshBasicMaterial color="#ffc589" />
        </mesh>
      )}
    </group>
  );
}

export function Units({
  colony,
  visible,
  selected,
}: {
  colony: ColonyState;
  visible: (position: Tile) => boolean;
  selected: string | null;
}) {
  const units: Unit[] = [
    ...colony.residents.map(
      (resident): Unit => ({
        kind: 'resident',
        ...resident,
        previous: resident.previousPosition,
      }),
    ),
    ...colony.industry.drones.map((drone): Unit => ({ ...drone })),
  ];
  const buggy = colony.immigration.convoy;
  if (buggy)
    units.push({ ...buggy, kind: 'buggy', previous: buggy.previousPosition });
  return units
    .filter(({ position }) => visible(position))
    .map((unit) => (
      <UnitModel
        key={unit.id}
        unit={unit}
        seed={colony.seed}
        landing={colony.landingZone}
        speed={colony.speed}
        selected={selected === unit.id}
      />
    ));
}
