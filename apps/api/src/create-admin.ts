import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { databaseClient } from './database.js';
import { hashPassword } from './admin-security.js';
const email = z
  .string()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase())
  .parse(process.argv[2]);
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required; apply migrations first');
if (process.stdin.isTTY)
  throw new Error(
    'Read the password privately and pipe it on stdin; do not put passwords in command arguments',
  );
const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
const passwordHash = await hashPassword(password);
const db = databaseClient(process.env.DATABASE_URL);
try {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(440042)::text`;
    if (await tx.user.findFirst({ where: { role: 'ADMIN' } }))
      throw new Error(
        'An administrator already exists; use Admin Account to change its password',
      );
    const user = await tx.user.create({
      data: { email, passwordHash, role: 'ADMIN' },
    });
    await tx.adminAudit.create({
      data: {
        actorId: user.id,
        action: 'admin.initial-create',
        detail: { method: 'controlled-cli' },
      },
    });
  });
  process.stdout.write(
    'Initial administrator created. Sign in at /admin and initialise the draft.\n',
  );
} catch {
  process.stderr.write(
    'Administrator creation failed. Check migrations, email uniqueness and whether an administrator already exists.\n',
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
