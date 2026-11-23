import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { BuildingModel, ModelState } from '@mars/simulation';
import {
  AnimationMixer,
  Box3,
  Color,
  Euler,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

type Size = [number, number, number];

function Model({
  url,
  model,
  state,
  playing,
  reset,
  onSize,
}: {
  url: string;
  model: BuildingModel;
  state: ModelState;
  playing: boolean;
  reset: number;
  onSize?: (size: Size) => void;
}) {
  const gltf = useGLTF(url, false, false);
  const instance = useMemo(() => {
    const copy = clone(gltf.scene);
    const indices: (number | undefined)[] = [];
    gltf.scene.traverse((object) =>
      indices.push(gltf.parser.associations.get(object)?.nodes),
    );
    const parts = new Map<number, Object3D>();
    const owned = new Set<MeshStandardMaterial>();
    const pulses = Object.values(model.animations).some(
      (entry) => entry?.method === 'builtin' && entry.effect === 'pulse',
    );
    let index = 0;
    copy.traverse((object) => {
      const node = indices[index++];
      if (node !== undefined) parts.set(node, object);
      if (!(object instanceof Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      if (!pulses) return;
      function localMaterial(material: unknown) {
        if (!(material instanceof MeshStandardMaterial)) return material;
        const local = material.clone();
        owned.add(local);
        return local;
      }
      object.material = Array.isArray(object.material)
        ? object.material.map(localMaterial)
        : localMaterial(object.material);
    });
    const raw = new Box3().setFromObject(copy);
    if (raw.isEmpty()) throw new Error('The model has no visible bounds.');
    return { scene: copy, parts, owned, raw, mixer: new AnimationMixer(copy) };
  }, [gltf, model.animations]);
  const transform = useMemo(() => {
    const group = new Group();
    const rotation = new Euler(
      ...(model.rotation.map((angle) => (angle * Math.PI) / 180) as Size),
    );
    group.rotation.copy(rotation);
    group.scale.setScalar(model.scale);
    group.updateMatrix();
    const bounds = instance.raw.clone().applyMatrix4(group.matrix);
    const size = bounds.getSize(new Vector3()).toArray() as Size;
    const center = bounds.getCenter(new Vector3());
    const position: Size = [...model.position];
    if (model.ground) {
      position[0] -= center.x;
      position[1] -= bounds.min.y;
      position[2] -= center.z;
    }
    if (
      ![...size, ...position].every(Number.isFinite) ||
      Math.max(...size) > 1000
    )
      throw new Error('The model is outside the supported preview bounds.');
    return { position, rotation, size };
  }, [instance.raw, model.ground, model.position, model.rotation, model.scale]);

  useEffect(() => {
    onSize?.(transform.size);
  }, [onSize, transform.size]);
  useEffect(
    () => () => {
      instance.mixer.stopAllAction();
      instance.mixer.uncacheRoot(instance.scene);
      instance.owned.forEach((material) => material.dispose());
    },
    [instance],
  );

  const animation = model.animations[state];
  const step = useRef<((delta: number) => void) | null>(null);
  useEffect(() => {
    step.current = null;
    if (!animation) return;
    if (animation.method === 'clip') {
      const clip = gltf.animations[animation.clip];
      if (!clip) return;
      const action = instance.mixer.clipAction(clip);
      action
        .reset()
        .setEffectiveTimeScale(animation.speed)
        .setLoop(
          animation.loop ? LoopRepeat : LoopOnce,
          animation.loop ? Infinity : 1,
        )
        .play();
      action.clampWhenFinished = true;
      step.current = (delta) => instance.mixer.update(delta);
      return () => {
        step.current = null;
        action.stop();
      };
    }
    const target =
      animation.part === null
        ? instance.scene
        : instance.parts.get(animation.part);
    if (!target) return;
    const position = target.position.clone();
    const rotation = target.rotation.clone();
    const materials = new Map<
      MeshStandardMaterial,
      { color: Color; intensity: number }
    >();
    if (animation.effect === 'pulse')
      target.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          if (instance.owned.has(material) && !materials.has(material))
            materials.set(material, {
              color: material.emissive.clone(),
              intensity: material.emissiveIntensity,
            });
      });
    const axis =
      animation.effect === 'vertical'
        ? 'y'
        : animation.effect === 'horizontal' && animation.axis === 'y'
          ? 'x'
          : animation.axis;
    let time = 0;
    step.current = (delta) => {
      time += delta * animation.speed;
      const turns = animation.loop ? time : Math.min(1, time);
      const wave = Math.sin(turns * Math.PI * 2) * animation.direction;
      if (animation.effect === 'rotate')
        target.rotation[axis] =
          rotation[axis] + turns * Math.PI * 2 * animation.direction;
      else if (animation.effect === 'pulse')
        for (const [material, base] of materials) {
          if (base.color.getHex() === 0) material.emissive.set('#ffb465');
          material.emissiveIntensity =
            (base.intensity || 1) * (0.25 + 0.75 * (1 + wave));
        }
      else target.position[axis] = position[axis] + wave * animation.distance;
    };
    return () => {
      step.current = null;
      target.position.copy(position);
      target.rotation.copy(rotation);
      materials.forEach(({ color, intensity }, material) => {
        material.emissive.copy(color);
        material.emissiveIntensity = intensity;
      });
    };
  }, [animation, gltf.animations, instance, reset, state]);
  useFrame((_, delta) => {
    if (playing) step.current?.(Math.min(delta, 0.1));
  });
  return (
    <group
      position={transform.position}
      rotation={transform.rotation}
      scale={model.scale}
    >
      <primitive object={instance.scene} />
    </group>
  );
}

export class ModelBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    revision?: string;
    onFailure?: () => void;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure?.();
  }
  componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (this.state.failed && previous.revision !== this.props.revision)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function UploadedModel({
  model,
  admin,
  state,
  playing,
  reset = 0,
  onSize,
  fallback,
  loading = fallback,
}: {
  model: BuildingModel;
  admin?: boolean;
  state: ModelState;
  playing: boolean;
  reset?: number;
  onSize?: (size: Size) => void;
  fallback: ReactNode;
  loading?: ReactNode;
}) {
  const url = admin
    ? `/api/admin/assets/${model.asset}`
    : `/api/catalogue-assets/${model.asset}`;
  return (
    <ModelBoundary
      key={url}
      fallback={fallback}
      revision={JSON.stringify([
        model.scale,
        model.position,
        model.rotation,
        model.ground,
      ])}
    >
      <Suspense fallback={loading}>
        <Model
          url={url}
          model={model}
          state={state}
          playing={playing}
          reset={reset}
          onSize={onSize}
        />
      </Suspense>
    </ModelBoundary>
  );
}
