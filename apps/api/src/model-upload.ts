import { validateBytes } from 'gltf-validator';
import sharp from 'sharp';
import type { ModelMetadata } from '@mars/simulation';
import { AdminError } from './admin-error.js';
import { maxAssetBytes } from './asset-storage.js';

export const modelMime = 'model/gltf-binary';
export const modelSlot = 'building-model';
export const oversizedModel = () =>
  new AdminError(413, 'GLB models must be 8 MiB or smaller.');
const invalid = (reason: string) => new AdminError(422, reason);

const extensions = new Set([
  'KHR_mesh_quantization',
  'KHR_materials_unlit',
  'KHR_materials_clearcoat',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_specular',
  'KHR_texture_transform',
]);
type Item = Record<string, unknown>;
function item(value: unknown): Item {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid('Invalid GLB document.');
  return value as Item;
}
function array(value: unknown, limit: number): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit)
    throw invalid('The GLB exceeds the supported scene complexity limits.');
  return value;
}
function integer(value: unknown, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    throw invalid('Invalid GLB index, accessor count, or buffer range.');
  return value;
}

function parseGlb(input: Buffer) {
  if (input.toString('ascii', 0, 4) !== 'glTF')
    throw new AdminError(415, 'Choose a binary glTF 2.0 (.glb) model.');
  if (input.length > maxAssetBytes) throw oversizedModel();
  if (
    input.length < 28 ||
    input.readUInt32LE(4) !== 2 ||
    input.readUInt32LE(8) !== input.length
  )
    throw invalid('Invalid GLB 2.0 header or file length.');
  const length = input.readUInt32LE(12);
  const end = 20 + length;
  if (
    length % 4 ||
    length > 1024 * 1024 ||
    end + 8 > input.length ||
    input.readUInt32LE(16) !== 0x4e4f534a ||
    input.readUInt32LE(end + 4) !== 0x004e4942 ||
    input.readUInt32LE(end) + end + 8 !== input.length
  )
    throw invalid(
      'Export a GLB with one embedded JSON chunk and one binary chunk.',
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(input.subarray(20, end)),
    );
  } catch {
    throw invalid('The GLB contains invalid JSON.');
  }
  return { doc: item(parsed), binary: input.subarray(end + 8) };
}

function describe(doc: Item): ModelMetadata {
  const nodes = array(doc.nodes, 512).map(item);
  const scenes = array(doc.scenes, 1).map(item);
  if (scenes.length !== 1 || (doc.scene !== undefined && doc.scene !== 0))
    throw invalid('Export a single scene in the GLB.');
  const seen = new Set<number>();
  const parts: ModelMetadata['parts'] = [];
  let meshes = 0;
  function visit(value: unknown, depth: number) {
    const index = integer(value, nodes.length - 1);
    if (seen.has(index) || depth > 32)
      throw invalid(
        'The GLB has a cyclic, shared, or excessively deep node hierarchy.',
      );
    seen.add(index);
    const node = nodes[index]!;
    if (node.mesh !== undefined) meshes++;
    if (typeof node.name === 'string' && node.name.trim())
      parts.push({ index, name: node.name.trim().slice(0, 120) });
    for (const child of array(node.children, 512)) visit(child, depth + 1);
  }
  for (const root of array(scenes[0]!.nodes, 512)) visit(root, 1);
  if (!meshes) throw invalid('The GLB scene must contain at least one mesh.');
  return {
    parts,
    clips: array(doc.animations, 64).map((value, index) => {
      const name = item(value).name;
      return {
        index,
        name:
          (typeof name === 'string' && name.trim().slice(0, 120)) ||
          `Clip ${index + 1}`,
      };
    }),
  };
}

export function modelMetadata(input: Buffer) {
  return describe(parseGlb(input).doc);
}

export async function prepareModel(data: string) {
  if (data.length > 4 * Math.ceil(maxAssetBytes / 3)) throw oversizedModel();
  if (data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw invalid('Invalid model data. Choose the GLB file again.');
  const input = Buffer.from(data, 'base64');
  const { doc, binary } = parseGlb(input);
  const metadata = describe(doc);
  const buffers = array(doc.buffers, 1).map(item);
  const images = array(doc.images, 16).map(item);
  if (
    buffers.length !== 1 ||
    [...buffers, ...images].some((entry) => 'uri' in entry)
  )
    throw invalid(
      'Pack all buffers and textures inside the GLB. External resources are unsupported.',
    );
  if (
    [
      ...array(doc.extensionsUsed, 16),
      ...array(doc.extensionsRequired, 16),
    ].some(
      (extension) =>
        typeof extension !== 'string' || !extensions.has(extension),
    )
  )
    throw invalid(
      'The GLB uses an unsupported extension. Export without Draco, Meshopt, or KTX compression.',
    );
  for (const key of [
    'materials',
    'textures',
    'bufferViews',
    'skins',
    'cameras',
  ])
    array(doc[key], 1024);
  const accessors = array(doc.accessors, 1024).map(item);
  const elements = accessors.reduce(
    (count, accessor) => count + integer(accessor.count, 500000),
    0,
  );
  if (elements > 2_000_000)
    throw invalid(
      'The GLB exceeds the total geometry and animation data budget.',
    );
  const meshes = array(doc.meshes, 256).map(item);
  let vertices = 0;
  let draws = 0;
  for (const node of array(doc.nodes, 512).map(item)) {
    if (node.mesh === undefined) continue;
    const mesh = meshes[integer(node.mesh, meshes.length - 1)]!;
    for (const primitive of array(mesh.primitives, 32).map(item)) {
      const attributes = item(primitive.attributes);
      const accessor =
        accessors[integer(attributes.POSITION, accessors.length - 1)]!;
      vertices += integer(accessor.count, 500000);
      if (primitive.indices !== undefined) {
        const indices =
          accessors[integer(primitive.indices, accessors.length - 1)]!;
        vertices += integer(indices.count, 500000);
      }
      draws++;
    }
  }
  if (vertices > 750000 || draws > 256)
    throw invalid(
      'The GLB exceeds the mesh budget. Reduce vertices, indices, or draw calls.',
    );
  let animationChannels = 0;
  for (const animation of array(doc.animations, 64).map(item)) {
    array(animation.samplers, 256);
    animationChannels += array(animation.channels, 256).length;
  }
  if (animationChannels > 1024)
    throw invalid('The GLB contains too many animation channels.');
  const views = array(doc.bufferViews, 1024).map(item);
  let pixels = 0;
  for (const image of images) {
    const view = views[integer(image.bufferView, views.length - 1)]!;
    const offset = integer(view.byteOffset ?? 0, binary.length);
    const size = integer(view.byteLength, binary.length - offset);
    if (!['image/png', 'image/jpeg'].includes(String(image.mimeType)))
      throw invalid('Only embedded PNG and JPEG textures are supported.');
    try {
      const info = await sharp(binary.subarray(offset, offset + size), {
        limitInputPixels: 4096 ** 2,
      }).metadata();
      const format = image.mimeType === 'image/png' ? 'png' : 'jpeg';
      if (
        info.format !== format ||
        !info.width ||
        !info.height ||
        info.width > 4096 ||
        info.height > 4096 ||
        (info.pages ?? 1) > 1
      )
        throw new Error('Unsupported texture');
      pixels += info.width * info.height;
    } catch {
      throw invalid(
        'The GLB has an unreadable or oversized texture. Use still PNG/JPEG textures up to 4096 pixels per side.',
      );
    }
  }
  if (pixels > 16 * 1024 * 1024)
    throw invalid('The GLB exceeds the total texture pixel budget.');
  const result = await validateBytes(input, {
    maxIssues: 100,
    externalResourceFunction: async () => {
      throw new Error('External GLB resources are blocked');
    },
  }).catch(() => {
    throw invalid('The GLB could not be validated. Export the model again.');
  });
  if (result.issues.numErrors) {
    const code = result.issues.messages.find(
      (message) => message.severity === 0,
    )?.code;
    throw invalid(
      `The GLB failed glTF validation${code ? ` (${code})` : ''}. Export the model again.`,
    );
  }
  return { bytes: input, metadata };
}
