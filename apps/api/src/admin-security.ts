import {
  randomBytes,
  scrypt as nativeScrypt,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const deriveKey = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    nativeScrypt(password, salt, 64, scryptOptions, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
export const hashToken = (s: string) =>
  createHash('sha256').update(s).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 128)
    throw new Error('Password must contain 12–128 characters');
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt);
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, cost, block, parallel, salt, hash] = encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    cost !== '32768' ||
    block !== '8' ||
    parallel !== '3' ||
    !salt ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !hash ||
    !/^[a-f0-9]{128}$/.test(hash)
  )
    return false;
  const key = await deriveKey(password, salt);
  return timingSafeEqual(key, Buffer.from(hash, 'hex'));
}
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
