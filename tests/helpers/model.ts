import { BoxGeometry, CylinderGeometry } from 'three';

export function glb(document: Record<string, unknown>, payload: Buffer) {
  const json = Buffer.from(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binLength = Math.ceil(payload.length / 4) * 4;
  const result = Buffer.alloc(28 + jsonLength + binLength);
  result.write('glTF', 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(0x20, 20, 20 + jsonLength);
  json.copy(result, 20);
  result.writeUInt32LE(binLength, 20 + jsonLength);
  result.writeUInt32LE(0x004e4942, 24 + jsonLength);
  payload.copy(result, 28 + jsonLength);
  return result;
}

export function waterTankGlb(bufferUri?: string) {
  const chunks: Buffer[] = [];
  const views: {
    buffer: number;
    byteOffset: number;
    byteLength: number;
    target?: number;
  }[] = [];
  const accessors: Record<string, unknown>[] = [];
  let offset = 0;
  function accessor(
    data: Float32Array | Uint16Array<ArrayBufferLike>,
    type: 'SCALAR' | 'VEC3' | 'VEC4',
    target?: number,
    bounds?: { min: number[]; max: number[] },
  ) {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
      target,
    });
    const chunk = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
    bytes.copy(chunk);
    chunks.push(chunk);
    offset += chunk.length;
    accessors.push({
      bufferView: views.length - 1,
      componentType: data instanceof Float32Array ? 5126 : 5123,
      count: data.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type],
      type,
      ...bounds,
    });
    return accessors.length - 1;
  }
  const meshes = [
    new CylinderGeometry(0.37, 0.43, 0.9, 16),
    new BoxGeometry(0.51, 0.12, 0.15),
  ].map((geometry, material) => {
    geometry.computeBoundingBox();
    const POSITION = accessor(
      geometry.attributes.position!.array as Float32Array,
      'VEC3',
      34962,
      {
        min: geometry.boundingBox!.min.toArray(),
        max: geometry.boundingBox!.max.toArray(),
      },
    );
    const NORMAL = accessor(
      geometry.attributes.normal!.array as Float32Array,
      'VEC3',
      34962,
    );
    const indices = accessor(
      geometry.index!.array as Uint16Array,
      'SCALAR',
      34963,
    );
    geometry.dispose();
    return {
      primitives: [{ attributes: { POSITION, NORMAL }, indices, material }],
    };
  });
  const input = accessor(new Float32Array([0, 0.5, 1]), 'SCALAR', undefined, {
    min: [0],
    max: [1],
  });
  const output = accessor(
    new Float32Array([
      0,
      0,
      0,
      1,
      0,
      Math.SQRT1_2,
      0,
      Math.SQRT1_2,
      0,
      1,
      0,
      0,
    ]),
    'VEC4',
  );
  return glb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { name: 'Water Tank Shell', mesh: 0, translation: [0, 0.45, 0] },
        { name: 'Pump Rotor', mesh: 1, translation: [0, 0.96, 0] },
      ],
      meshes,
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorFactor: [0.12, 0.48, 0.72, 1],
            metallicFactor: 0.22,
            roughnessFactor: 0.35,
          },
        },
        {
          pbrMetallicRoughness: {
            baseColorFactor: [1, 0.42, 0.1, 1],
            metallicFactor: 0.2,
            roughnessFactor: 0.5,
          },
        },
      ],
      accessors,
      bufferViews: views,
      buffers: [{ byteLength: offset, uri: bufferUri }],
      animations: [
        {
          name: 'Pump cycle',
          channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }],
          samplers: [{ input, output }],
        },
      ],
    },
    Buffer.concat(chunks),
  );
}
