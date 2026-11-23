import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  buildingAt,
  CHUNK_SIZE,
  footprint,
  routeBetween,
  runtimeCatalogue,
  tileKey,
  WORLD_SIZE,
  type Tile,
} from '@mars/simulation';
import { Group, MOUSE, Raycaster, Vector2, Vector3, Object3D } from 'three';
import type { WorldProps } from '../World';
import { BuildingRenderer, ProceduralBuilding, TileMarker } from './Buildings';
import { Infrastructure } from './Infrastructure';
import { infrastructureLinks } from './infrastructure';
import { Terrain } from './Terrain';
import { surfaceAt, terrainWindow, worldTile } from './terrain';
import { Units } from './Units';

const landingDefault = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
const cameraOffset = new Vector3(11, 14, 15);
const vertical = new Vector3(0, 1, 0);
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

type Props = WorldProps & { low: boolean; onFallback: () => void };

function Descent({
  landing,
  seed,
  onTouchdown,
}: {
  landing: Tile;
  seed: number;
  onTouchdown: () => void;
}) {
  const ship = useRef<Group>(null);
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    if (!ship.current || elapsed.current >= 4.5) return;
    elapsed.current = Math.min(4.5, elapsed.current + delta);
    const progress = elapsed.current / 4.5;
    ship.current.position.y =
      surfaceAt(seed, landing.x, landing.y, landing) + (1 - progress) ** 2 * 14;
    if (progress === 1) onTouchdown();
  });
  return (
    <group ref={ship} position={[landing.x, 14, landing.y]}>
      <ProceduralBuilding type="starship" width={2} depth={2} />
    </group>
  );
}

function Scene(props: Props) {
  const {
    colony,
    low,
    mission,
    focus,
    construction,
    selected,
    hovered,
    view,
    draft,
    routeValid,
  } = props;
  const seed = colony?.seed ?? 1;
  const landing = colony?.landingZone ?? landingDefault;
  const latest = useRef(props);
  latest.current = props;
  const ground = useRef<Group>(null);
  const buildings = useRef<Group>(null);
  const units = useRef<Group>(null);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const { gl, camera } = useThree();
  const [windowCenter, setWindowCenter] = useState(landing);
  const [focusTarget, setFocusTarget] = useState<Tile | null>(null);
  const chunkX = Math.floor(windowCenter.x / CHUNK_SIZE);
  const chunkZ = Math.floor(windowCenter.y / CHUNK_SIZE);
  const radius = low ? 2 : 3;
  const chunks = useMemo(
    () => terrainWindow(chunkX * CHUNK_SIZE, chunkZ * CHUNK_SIZE, radius),
    [chunkX, chunkZ, radius],
  );
  const visible = useCallback(
    (tile: Tile) =>
      Math.max(
        Math.abs(Math.floor(tile.x / CHUNK_SIZE) - chunkX),
        Math.abs(Math.floor(tile.y / CHUNK_SIZE) - chunkZ),
      ) <= radius,
    [chunkX, chunkZ, radius],
  );
  const keys = useRef(new Set<string>());
  const pointer = useRef({ active: false, edgeX: 0, edgeY: 0 });
  const lightTarget = useMemo(() => new Object3D(), []);
  const offset = useRef(new Vector3());
  const heading = useRef(new Vector3());
  const motion = useRef(new Vector3());
  const controlsDirty = useRef(true);
  const lastTile = useRef<Tile | null>(null);
  const diagnosticsAt = useRef(0);
  const definitions = runtimeCatalogue(colony ?? undefined).buildings;
  const knownBuildings = useRef<{
    mission: number;
    active: boolean;
    ids: Set<string>;
  }>({ mission: -1, active: false, ids: new Set() });
  const active = colony?.phase === 'active';
  if (
    knownBuildings.current.mission !== mission ||
    active !== knownBuildings.current.active
  ) {
    knownBuildings.current = {
      mission,
      active,
      ids: new Set(colony?.buildings.map((building) => building.id)),
    };
  }
  const selectedBuilding =
    colony && selected ? buildingAt(colony, selected) : undefined;
  const footprintTiles = !colony
    ? []
    : construction && hovered
      ? footprint(construction, hovered, colony)
      : selectedBuilding
        ? footprint(selectedBuilding.type, selectedBuilding, colony)
        : selected
          ? [selected]
          : [];
  const links = useMemo(
    () => (colony ? infrastructureLinks(colony, visible, view, selected) : []),
    [colony, visible, view, selected],
  );

  useLayoutEffect(() => {
    const target = controls.current?.target;
    if (!target) return;
    const current = latest.current.colony;
    const site = current?.landingZone ?? landingDefault;
    target.set(
      site.x,
      surfaceAt(current?.seed ?? 1, site.x, site.y, site),
      site.y,
    );
    camera.position.copy(target).add(cameraOffset);
    controls.current?.update();
    controlsDirty.current = true;
    setWindowCenter(site);
    setFocusTarget(null);
    lastTile.current = null;
  }, [camera, mission, seed, landing.x, landing.y]);

  useEffect(() => {
    if (focus) setFocusTarget(focus);
  }, [focus]);

  useEffect(() => {
    const element = gl.domElement;
    const ray = new Raycaster();
    const ndc = new Vector2();
    let start: {
      x: number;
      y: number;
      target?: { resident?: string; tile?: Tile };
    } | null = null;
    let route: Tile[] | null = null;
    function project(event: PointerEvent, pick = false) {
      const bounds = element.getBoundingClientRect();
      ndc.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        1 - ((event.clientY - bounds.top) / bounds.height) * 2,
      );
      ray.setFromCamera(ndc, camera);
      const surface = ray.intersectObjects(
        ground.current?.children.filter((object) => object.userData.terrain) ??
          [],
        false,
      )[0];
      let target: { resident?: string; tile?: Tile } | undefined;
      if (pick) {
        const roots = [buildings.current, units.current].filter(
          (root): root is Group => root !== null,
        );
        for (const hit of ray.intersectObjects(roots, true)) {
          if (surface && hit.distance > surface.distance) break;
          let object: Object3D | null = hit.object;
          while (object && !object.userData.resident && !object.userData.tile)
            object = object.parent;
          if (object) {
            target = object.userData;
            break;
          }
        }
      }
      return {
        tile: surface ? worldTile(surface.point.x, surface.point.z) : null,
        target,
      };
    }
    function enter() {
      pointer.current.active = true;
    }
    function hover(tile: Tile | null) {
      if (lastTile.current?.x === tile?.x && lastTile.current?.y === tile?.y)
        return;
      lastTile.current = tile;
      latest.current.onHover(tile);
    }
    function down(event: PointerEvent) {
      if (event.button !== 0 || !event.isPrimary) return;
      setFocusTarget(null);
      const state = latest.current;
      const result = project(
        event,
        !state.construction && !state.infrastructureTool,
      );
      start = { x: event.clientX, y: event.clientY, target: result.target };
      if (state.infrastructureTool) {
        route = result.tile ? [result.tile] : [];
        state.onRoute(route);
      }
    }
    function move(event: PointerEvent) {
      const bounds = element.getBoundingClientRect();
      const edge = (distance: number, length: number) =>
        distance < 18 ? -1 : distance > length - 18 ? 1 : 0;
      pointer.current.edgeX = edge(event.clientX - bounds.left, bounds.width);
      pointer.current.edgeY = edge(event.clientY - bounds.top, bounds.height);
      const state = latest.current;
      if (!state.construction && !state.infrastructureTool) return;
      const { tile } = project(event);
      hover(tile);
      if (
        !route ||
        !tile ||
        !state.infrastructureTool ||
        route.length >= WORLD_SIZE ** 2
      )
        return;
      const last = route.at(-1);
      if (last?.x === tile.x && last.y === tile.y) return;
      route = [
        ...new Map(
          [...route, ...(last ? routeBetween(last, tile) : [tile])].map(
            (step) => [tileKey(step), step],
          ),
        ).values(),
      ];
      state.onRoute(route);
    }
    function up(event: PointerEvent) {
      if (event.button !== 0 || !event.isPrimary || !start) return;
      const press = start;
      start = null;
      const state = latest.current;
      if (route) {
        route = null;
        return;
      }
      const moved =
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5;
      if (moved) return;
      const result = project(event, !state.construction);
      if (!state.construction) {
        const resident = press.target?.resident ?? result.target?.resident;
        if (resident) {
          state.onResidentSelect(resident);
          return;
        }
      }
      const tile = state.construction
        ? result.tile
        : (result.target?.tile ?? result.tile);
      if (tile) state.onSelect(tile);
    }
    function leave() {
      pointer.current = { active: false, edgeX: 0, edgeY: 0 };
      hover(null);
      start = null;
      route = null;
      keys.current.clear();
    }
    function contextMenu(event: MouseEvent) {
      event.preventDefault();
      const state = latest.current;
      if (state.construction || state.infrastructureTool) {
        route = null;
        hover(null);
        state.onCancel();
      }
    }
    function keyboard(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (event.type === 'keyup') {
        keys.current.delete(key);
        return;
      }
      if (!pointer.current.active && document.activeElement !== element) return;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest('input, select, textarea, [contenteditable]'))
      )
        return;
      if (!['w', 'a', 's', 'd', 'q', 'e'].includes(key)) return;
      event.preventDefault();
      keys.current.add(key);
      setFocusTarget(null);
    }
    function blur() {
      keys.current.clear();
    }
    function contextLost(event: Event) {
      event.preventDefault();
      latest.current.onFallback();
    }
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('pointercancel', leave);
    element.addEventListener('contextmenu', contextMenu);
    element.addEventListener('webglcontextlost', contextLost);
    window.addEventListener('keydown', keyboard);
    window.addEventListener('keyup', keyboard);
    window.addEventListener('blur', blur);
    return () => {
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('pointercancel', leave);
      element.removeEventListener('contextmenu', contextMenu);
      element.removeEventListener('webglcontextlost', contextLost);
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('keyup', keyboard);
      window.removeEventListener('blur', blur);
    };
  }, [camera, gl]);

  useFrame((_, delta) => {
    const control = controls.current;
    if (!control) return;
    const step = Math.min(delta, 0.05);
    const target = control.target;
    const oldX = target.x;
    const oldZ = target.z;
    if (focusTarget) {
      const amount =
        Math.hypot(focusTarget.x - target.x, focusTarget.y - target.z) > 45
          ? 1
          : 1 - Math.exp(-step * 8);
      target.x += (focusTarget.x - target.x) * amount;
      target.z += (focusTarget.y - target.z) * amount;
      if (
        Math.hypot(focusTarget.x - target.x, focusTarget.y - target.z) < 0.03
      ) {
        target.x = focusTarget.x;
        target.z = focusTarget.y;
        setFocusTarget(null);
      }
    }
    const pressed = keys.current;
    const edge =
      !construction && !props.infrastructureTool && !focusTarget
        ? pointer.current
        : undefined;
    const horizontal =
      Number(pressed.has('d')) - Number(pressed.has('a')) + (edge?.edgeX ?? 0);
    const forward =
      Number(pressed.has('w')) - Number(pressed.has('s')) - (edge?.edgeY ?? 0);
    if (horizontal || forward) {
      heading.current.subVectors(target, camera.position).setY(0).normalize();
      motion.current
        .crossVectors(heading.current, vertical)
        .multiplyScalar(horizontal)
        .addScaledVector(heading.current, forward)
        .normalize()
        .multiplyScalar(step * 10);
      target.x += motion.current.x;
      target.z += motion.current.z;
    }
    target.x = clamp(target.x, WORLD_SIZE - 1);
    target.z = clamp(target.z, WORLD_SIZE - 1);
    const elevation = surfaceAt(seed, target.x, target.z, landing);
    camera.position.x += target.x - oldX;
    camera.position.z += target.z - oldZ;
    camera.position.y += elevation - target.y;
    target.y = elevation;
    const yaw = Number(pressed.has('q')) - Number(pressed.has('e'));
    if (yaw)
      camera.position.copy(
        offset.current
          .subVectors(camera.position, target)
          .applyAxisAngle(vertical, yaw * step * 1.4)
          .add(target),
      );
    const floor = surfaceAt(
      seed,
      camera.position.x,
      camera.position.z,
      landing,
    );
    camera.position.y = Math.max(camera.position.y, floor + 0.55);
    if (horizontal || forward || yaw || oldX !== target.x || oldZ !== target.z)
      control.update();
    const nextChunkX = Math.floor(target.x / CHUNK_SIZE);
    const nextChunkZ = Math.floor(target.z / CHUNK_SIZE);
    if (nextChunkX !== chunkX || nextChunkZ !== chunkZ) {
      setWindowCenter({
        x: nextChunkX * CHUNK_SIZE,
        y: nextChunkZ * CHUNK_SIZE,
      });
    }
    diagnosticsAt.current += delta;
    if (controlsDirty.current || diagnosticsAt.current > 0.8) {
      controlsDirty.current = false;
      diagnosticsAt.current = 0;
      const canvas = gl.domElement;
      canvas.dataset.cameraPosition = camera.position.toArray().join(',');
      canvas.dataset.cameraTarget = target.toArray().join(',');
      canvas.dataset.terrainChunks = String(chunks.length);
      canvas.dataset.triangles = String(gl.info.render.triangles);
      canvas.dataset.drawCalls = String(gl.info.render.calls);
      canvas.dataset.geometries = String(gl.info.memory.geometries);
    }
  });

  const footColor =
    !construction || props.buildingPreviewValid ? '#65e4ab' : '#ff5c4d';
  const type = construction && hovered ? definitions[construction] : null;
  const deposition =
    view === 'geology' && colony
      ? chunks.flatMap(
          ({ x, z }) =>
            colony.world.chunks[tileKey({ x, y: z })]?.deposits.filter(
              (deposit) => deposit.discovered,
            ) ?? [],
        )
      : [];
  return (
    <>
      <color attach="background" args={['#a77b67']} />
      <fog attach="fog" args={['#a77b67', low ? 21 : 27, low ? 44 : 57]} />
      <hemisphereLight intensity={2.15} color="#f7ded0" groundColor="#584340" />
      <primitive object={lightTarget} position={[landing.x, 0, landing.y]} />
      <directionalLight
        position={[landing.x - 12, 20, landing.y - 7]}
        target={lightTarget}
        intensity={2.55}
        color="#ffcfaa"
        castShadow={!low}
        shadow-mapSize={[768, 768]}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-near={1}
        shadow-camera-far={52}
        shadow-normalBias={0.035}
      />
      <Terrain
        terrain={ground}
        chunks={chunks}
        world={colony?.world}
        seed={seed}
        landing={landing}
        rocks={!low}
      />
      <Infrastructure links={links} />
      <group ref={buildings}>
        {colony?.buildings.filter(visible).map((building) => {
          const { width, height } = definitions[building.type];
          return (
            <BuildingRenderer
              key={building.id}
              type={building.type}
              width={width}
              depth={height}
              tile={building}
              seed={seed}
              landing={landing}
              status={building.status}
              operating={building.status === 'running' && colony.speed > 0}
              animate={!knownBuildings.current.ids.has(building.id)}
            />
          );
        })}
      </group>
      <group ref={units}>
        {colony && active && (
          <Units
            colony={colony}
            visible={visible}
            selected={props.selectedResidentId}
          />
        )}
      </group>
      {footprintTiles
        .filter((tile) => worldTile(tile.x, tile.y))
        .map((tile) => (
          <TileMarker
            key={tileKey(tile)}
            tile={tile}
            seed={seed}
            landing={landing}
            color={footColor}
          />
        ))}
      {draft.map((tile) => (
        <TileMarker
          key={tileKey(tile)}
          tile={tile}
          seed={seed}
          landing={landing}
          color={routeValid ? '#65e4ab' : '#ff5c4d'}
        />
      ))}
      {deposition.map((tile) => (
        <TileMarker
          key={tile.id}
          tile={tile}
          seed={seed}
          landing={landing}
          color={tile.remainingQuantity > 0 ? '#d7bbf0' : '#a7a39e'}
        />
      ))}
      {construction && hovered && type && (
        <BuildingRenderer
          type={construction}
          width={type.width}
          depth={type.height}
          tile={hovered}
          seed={seed}
          landing={landing}
          tint={footColor}
        />
      )}
      {colony?.phase === 'landing' && (
        <Descent
          key={mission}
          landing={landing}
          seed={seed}
          onTouchdown={props.onTouchdown}
        />
      )}
      <OrbitControls
        ref={controls}
        enableDamping
        dampingFactor={0.14}
        minDistance={3}
        maxDistance={low ? 33 : 42}
        minPolarAngle={0.14}
        maxPolarAngle={1.31}
        screenSpacePanning={false}
        mouseButtons={{
          LEFT:
            construction || props.infrastructureTool ? undefined : MOUSE.PAN,
          MIDDLE: MOUSE.PAN,
          RIGHT:
            construction || props.infrastructureTool ? undefined : MOUSE.ROTATE,
        }}
        onChange={() => {
          controlsDirty.current = true;
        }}
      />
    </>
  );
}

class RendererBoundary extends Component<
  { children: ReactNode; onFallback: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFallback();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function World3D(props: Props) {
  return (
    <div className="world" aria-label="3D Mars terrain">
      <RendererBoundary onFallback={props.onFallback}>
        <Canvas
          shadows={!props.low}
          dpr={props.low ? 1 : [1, 1.5]}
          camera={{ fov: 45, near: 0.12, far: 110 }}
          gl={{ antialias: !props.low, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.domElement.tabIndex = 0;
            gl.domElement.setAttribute(
              'aria-label',
              'Interactive 3D colony map',
            );
          }}
        >
          <Scene {...props} />
        </Canvas>
      </RendererBoundary>
    </div>
  );
}
