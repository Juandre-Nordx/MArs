import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const subdirectory = 'catalogue-assets';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const maxAssetBytes = 8 * 1024 * 1024;
export const assetDigest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

export type AssetLocation = {
  id: string;
  digest: string;
  storageBackend: string;
  storageKey: string | null;
  byteSize: number | null;
  mime?: string;
};

export class AssetStorageError extends Error {
  constructor(
    public readonly statusCode: 404 | 503,
    message: string,
  ) {
    super(message);
  }
}

type AssetPayload = Pick<
  AssetLocation,
  'storageBackend' | 'storageKey' | 'byteSize'
> & {
  data: Uint8Array<ArrayBuffer> | null;
};

export interface AssetStorage {
  store(
    id: string,
    bytes: Buffer<ArrayBuffer>,
    mime?: string,
  ): Promise<AssetPayload>;
  read(asset: AssetLocation, data: Uint8Array | null): Promise<Buffer>;
  verify(asset: AssetLocation): Promise<void>;
}

const unavailable = () =>
  new AssetStorageError(
    503,
    'Artwork volume unavailable. Check the API volume mount and permissions.',
  );
const missing = () =>
  new AssetStorageError(404, 'Artwork file missing from the API volume');
async function syncDirectory(path: string) {
  const dir = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}

const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

function volumeKey(id: string, mime = 'image/png') {
  if (!uuid.test(id)) throw unavailable();
  return `${id}.${mime === 'model/gltf-binary' ? 'glb' : 'png'}`;
}

function under(path: string, root: string) {
  const base = resolve(root);
  return path === base || path.startsWith(base === sep ? sep : base + sep);
}

export function createAssetStorage(env: NodeJS.ProcessEnv): AssetStorage {
  const driver = env.ASSET_STORAGE_DRIVER ?? 'database';
  const root = env.ASSET_STORAGE_PATH;
  const railwayMount = env.RAILWAY_VOLUME_MOUNT_PATH;
  const blocked = [repo, tmpdir(), '/tmp', '/var/tmp', '/dev/shm'];
  const allowed = (path: string) =>
    path !== sep &&
    !blocked.some((base) => under(path, base)) &&
    !/(?:^|\/)(?:public|dist)(?:\/|$)/.test(path);

  async function directory(create: boolean) {
    if (
      !root ||
      !isAbsolute(root) ||
      !allowed(resolve(root)) ||
      (env.RAILWAY_ENVIRONMENT_ID && !railwayMount) ||
      (railwayMount && resolve(railwayMount) !== resolve(root))
    )
      throw unavailable();
    // Require the configured root to exist. Creating it could mask an absent mount.
    const canonical = await realpath(root);
    if (
      !allowed(canonical) ||
      canonical !== resolve(root) ||
      !(await lstat(canonical)).isDirectory()
    )
      throw unavailable();
    const dir = join(canonical, subdirectory);
    if (create)
      await mkdir(dir, { mode: 0o750 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        },
      );
    if (!(await lstat(dir)).isDirectory() || (await realpath(dir)) !== dir)
      throw unavailable();
    return dir;
  }

  async function readVolume(asset: AssetLocation) {
    const { id, byteSize, storageKey } = asset;
    if (
      storageKey !== volumeKey(id, asset.mime) ||
      !byteSize ||
      byteSize > maxAssetBytes
    )
      throw unavailable();
    let dir: string;
    try {
      dir = await directory(false);
    } catch {
      throw unavailable();
    }
    try {
      const file = await open(
        join(dir, storageKey),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size !== byteSize) throw unavailable();
        const result = Buffer.alloc(byteSize);
        let offset = 0;
        while (offset < byteSize) {
          const { bytesRead } = await file.read(
            result,
            offset,
            byteSize - offset,
            offset,
          );
          if (!bytesRead) throw unavailable();
          offset += bytesRead;
        }
        if (assetDigest(result) !== asset.digest) throw unavailable();
        return result;
      } finally {
        await file.close();
      }
    } catch (error) {
      if (isMissing(error)) throw missing();
      throw unavailable();
    }
  }

  return {
    async store(id, bytes, mime) {
      if (driver === 'database')
        return {
          storageBackend: 'database',
          storageKey: null,
          byteSize: bytes.length,
          data: bytes,
        };
      if (driver !== 'volume')
        throw new AssetStorageError(
          503,
          'Unknown artwork storage driver. Set ASSET_STORAGE_DRIVER to database or volume.',
        );
      try {
        const storageKey = volumeKey(id, mime);
        const dir = await directory(true);
        const temporary = join(dir, `.${randomUUID()}.part`);
        const file = await open(temporary, 'wx', 0o640);
        try {
          try {
            await file.writeFile(bytes);
            await file.sync();
          } finally {
            await file.close();
          }
          // An atomic, no-overwrite link publishes only the completed file.
          await link(temporary, join(dir, storageKey));
        } finally {
          await unlink(temporary);
        }
        await syncDirectory(dir);
        await syncDirectory(dirname(dir));
        return {
          storageBackend: 'volume',
          storageKey,
          byteSize: bytes.length,
          data: null,
        };
      } catch {
        throw unavailable();
      }
    },
    async read(asset, data) {
      if (asset.storageBackend === 'database' && data) return Buffer.from(data);
      if (asset.storageBackend === 'volume') return readVolume(asset);
      throw unavailable();
    },
    async verify(asset) {
      if (asset.storageBackend === 'volume') await readVolume(asset);
      else if (asset.storageBackend !== 'database') throw unavailable();
    },
  };
}
