import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

export function detailedTransparentPng() {
  const width = 1280;
  const height = 1280;
  const bytes = randomBytes(width * height * 4);
  for (let offset = 3; offset < width * 12 * 4; offset += 4) bytes[offset] = 0;
  for (
    let offset = (height - 12) * width * 4 + 3;
    offset < bytes.length;
    offset += 4
  )
    bytes[offset] = 255;
  return sharp(bytes, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
