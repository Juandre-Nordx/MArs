import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  assetDigest,
  createAssetStorage,
} from '../../apps/api/src/asset-storage.js';

it('writes immutable keys atomically and refuses traversal, invalid roots and symlinks', async () => {
  const root = await mkdtemp(
    join(process.env.MARS_TEST_ASSET_ROOT ?? resolve('..'), 'mars-volume-'),
  );
  const storage = createAssetStorage({
    ASSET_STORAGE_DRIVER: 'volume',
    ASSET_STORAGE_PATH: root,
  });
  const id = randomUUID();
  const bytes = Buffer.from('original');
  const dir = join(root, 'catalogue-assets');
  try {
    const location = {
      id,
      digest: assetDigest(bytes),
      ...(await storage.store(id, bytes)),
    };
    expect(location).toMatchObject({
      storageBackend: 'volume',
      storageKey: `${id}.png`,
      data: null,
    });
    expect(await readdir(dir)).toEqual([location.storageKey]);
    await expect(
      storage.store(id, Buffer.from('different')),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(await readdir(dir)).toEqual([location.storageKey]);
    expect(await storage.read(location, null)).toEqual(bytes);
    await expect(
      storage.read({ ...location, storageKey: '../other.png' }, null),
    ).rejects.toMatchObject({ statusCode: 503 });
    await expect(storage.store('../other', bytes)).rejects.toMatchObject({
      statusCode: 503,
    });

    const interruptedId = randomUUID();
    await writeFile(join(dir, `.${interruptedId}.part`), bytes);
    const interrupted = {
      ...location,
      id: interruptedId,
      storageKey: `${interruptedId}.png`,
    };
    await expect(storage.read(interrupted, null)).rejects.toMatchObject({
      statusCode: 404,
    });
    await symlink(
      join(dir, location.storageKey!),
      join(dir, interrupted.storageKey),
    );
    await expect(storage.read(interrupted, null)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(await readFile(join(dir, location.storageKey!))).toEqual(bytes);

    const brokenRoot = join(root, 'broken');
    await mkdir(brokenRoot);
    await writeFile(join(brokenRoot, 'catalogue-assets'), 'blocked');
    for (const invalid of [
      brokenRoot,
      join(root, 'absent'),
      '/tmp/mars-uploads',
      resolve('apps/web/public'),
    ]) {
      const broken = createAssetStorage({
        ASSET_STORAGE_DRIVER: 'volume',
        ASSET_STORAGE_PATH: invalid,
      });
      await expect(broken.store(randomUUID(), bytes)).rejects.toMatchObject({
        statusCode: 503,
      });
    }
    await expect(
      createAssetStorage({ ASSET_STORAGE_DRIVER: 'invalid' }).store(id, bytes),
    ).rejects.toMatchObject({ statusCode: 503 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
