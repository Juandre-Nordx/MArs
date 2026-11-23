import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { type Link } from './infrastructure';

function Batch({ links, road }: { links: Link[]; road: boolean }) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const instance = mesh.current;
    if (!instance) return;
    const from = new Vector3();
    const to = new Vector3();
    const midpoint = new Vector3();
    const direction = new Vector3();
    const size = new Vector3();
    const up = new Vector3(0, 1, 0);
    const rotation = new Quaternion();
    const transform = new Matrix4();
    const color = new Color();
    links.forEach((link, index) => {
      from.fromArray(link.from);
      to.fromArray(link.to);
      midpoint.copy(from).lerp(to, 0.5);
      direction.subVectors(to, from);
      const length = direction.length();
      rotation.setFromUnitVectors(up, direction.normalize());
      if (road) size.set(0.39, length + 0.06, 0.05);
      else {
        const diameter = link.type === 'power' ? 0.044 : 0.072;
        size.set(diameter, length + 0.025, diameter);
      }
      // Orient road width horizontally around the route, even when it runs east-west.
      if (road) {
        const side = new Vector3().crossVectors(up, direction).normalize();
        const normal = new Vector3().crossVectors(side, direction);
        rotation.setFromRotationMatrix(
          transform.makeBasis(side, direction, normal),
        );
      }
      instance.setMatrixAt(index, transform.compose(midpoint, rotation, size));
      instance.setColorAt(
        index,
        color.setHex(link.color).multiplyScalar(link.brightness),
      );
    });
    instance.instanceMatrix.needsUpdate = true;
    if (instance.instanceColor) instance.instanceColor.needsUpdate = true;
    instance.computeBoundingSphere();
  }, [links, road]);
  if (links.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, links.length]}
      receiveShadow
    >
      {road ? <boxGeometry /> : <cylinderGeometry args={[0.5, 0.5, 1, 6]} />}
      <meshStandardMaterial color="white" roughness={0.91} />
    </instancedMesh>
  );
}

export function Infrastructure({ links }: { links: Link[] }) {
  const roads = useMemo(
    () => links.filter(({ type }) => type === 'road'),
    [links],
  );
  const pipes = useMemo(
    () => links.filter(({ type }) => type !== 'road'),
    [links],
  );
  return (
    <>
      <Batch links={roads} road />
      <Batch links={pipes} road={false} />
    </>
  );
}
