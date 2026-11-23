import { expect, it } from 'vitest';
import { waterTankGlb } from '../helpers/model.js';
import { maxAssetBytes } from '../../apps/api/src/asset-storage.js';
import { prepareModel } from '../../apps/api/src/model-upload.js';

it('validates a self-contained GLB and lists its embedded clips and named nodes', async () => {
  const bytes = waterTankGlb();
  expect(await prepareModel(bytes.toString('base64'))).toEqual({
    bytes,
    metadata: {
      clips: [{ index: 0, name: 'Pump cycle' }],
      parts: [
        { index: 0, name: 'Water Tank Shell' },
        { index: 1, name: 'Pump Rotor' },
      ],
    },
  });
});

it('rejects wrong formats, truncated GLBs, oversized inputs and external resources', async () => {
  await expect(
    prepareModel(Buffer.from('fake').toString('base64')),
  ).rejects.toMatchObject({ statusCode: 415 });
  await expect(
    prepareModel(waterTankGlb().subarray(0, -4).toString('base64')),
  ).rejects.toMatchObject({ statusCode: 422 });
  await expect(
    prepareModel(Buffer.alloc(maxAssetBytes + 3).toString('base64')),
  ).rejects.toMatchObject({ statusCode: 413 });
  await expect(
    prepareModel(
      waterTankGlb('https://example.test/model.bin').toString('base64'),
    ),
  ).rejects.toThrow('External resources are unsupported');
});
