import sharp from 'sharp';
import { AdminError } from './admin-store.js';
import { maxAssetBytes } from './asset-storage.js';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function byteLimit(value: string | undefined, fallback: number) {
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes > 0
    ? Math.min(maxAssetBytes, Math.max(1024, bytes))
    : fallback;
}

export function artworkUploadLimits(env: NodeJS.ProcessEnv) {
  return {
    inputBytes: byteLimit(env.ADMIN_UPLOAD_INPUT_LIMIT_BYTES, maxAssetBytes),
    outputBytes: byteLimit(
      env.ADMIN_UPLOAD_OUTPUT_LIMIT_BYTES ?? env.ADMIN_UPLOAD_LIMIT_BYTES,
      2 * 1024 * 1024,
    ),
    spriteOutputBytes: byteLimit(
      env.ADMIN_UPLOAD_SPRITE_OUTPUT_LIMIT_BYTES,
      maxAssetBytes,
    ),
    minSide: 16,
    maxSide: 2048,
    iconSide: 512,
    maxPixels: 4 * 1024 * 1024,
  };
}

export type ArtworkUploadLimits = ReturnType<typeof artworkUploadLimits>;

export const oversizedInput = (limits: ArtworkUploadLimits) =>
  new AdminError(
    413,
    `File too large. The input limit is ${limits.inputBytes.toLocaleString('en-US')} bytes.`,
  );

function isAnimatedPng(input: Buffer) {
  for (let offset = pngSignature.length; offset + 12 <= input.length; ) {
    const type = input.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') return true;
    if (type === 'IEND') break;
    offset += 12 + input.readUInt32BE(offset);
  }
  return false;
}

export async function prepareArtwork(
  data: string,
  icon: boolean,
  limits: ArtworkUploadLimits,
) {
  if (data.length > 4 * Math.ceil(limits.inputBytes / 3))
    throw oversizedInput(limits);
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw new AdminError(
      422,
      'Invalid image data. Choose the PNG or WebP file again.',
    );
  const input = Buffer.from(data, 'base64');
  if (input.length > limits.inputBytes) throw oversizedInput(limits);

  const png = input.subarray(0, 8).equals(pngSignature);
  const webp =
    input.toString('ascii', 0, 4) === 'RIFF' &&
    input.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !webp)
    throw new AdminError(
      415,
      'Unsupported format. Choose a PNG or WebP image.',
    );

  const invalid = () =>
    new AdminError(
      422,
      'Invalid or unreadable image. Export it again as PNG or WebP.',
    );
  const dimensions = () =>
    new AdminError(
      422,
      `Image dimensions are outside the allowed range. Use ${limits.minSide}–${limits.maxSide} pixels per side and at most ${limits.maxPixels.toLocaleString('en-US')} pixels in total.`,
    );
  const image = sharp(input, {
    limitInputPixels: limits.maxPixels,
    failOn: 'warning',
  });
  const meta = await image.metadata().catch((error: unknown) => {
    if (
      error instanceof Error &&
      error.message === 'Input image exceeds pixel limit'
    )
      throw dimensions();
    throw invalid();
  });
  if (meta.format !== (png ? 'png' : 'webp')) throw invalid();
  const animatedWebp =
    webp &&
    input.toString('ascii', 12, 16) === 'VP8X' &&
    ((input[20] ?? 0) & 0x02) !== 0;
  if ((meta.pages ?? 1) > 1 || (png && isAnimatedPng(input)) || animatedWebp)
    throw new AdminError(
      422,
      'Animated artwork is unsupported. Export a single still frame.',
    );

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (
    width < limits.minSide ||
    height < limits.minSide ||
    width > limits.maxSide ||
    height > limits.maxSide ||
    width * height > limits.maxPixels
  )
    throw dimensions();
  if (icon)
    image.resize(limits.iconSide, limits.iconSide, {
      fit: 'inside',
      withoutEnlargement: true,
    });

  const output = await image
    .png()
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw invalid();
    });
  if (output.info.width < limits.minSide || output.info.height < limits.minSide)
    throw new AdminError(
      422,
      `The resized icon is too narrow. It must be at least ${limits.minSide} pixels per side.`,
    );
  const outputBytes = icon ? limits.outputBytes : limits.spriteOutputBytes;
  if (output.data.length > outputBytes)
    throw new AdminError(
      413,
      `The processed PNG exceeds the ${outputBytes.toLocaleString('en-US')}-byte output limit. Choose a less detailed or smaller image.`,
    );
  return output;
}
