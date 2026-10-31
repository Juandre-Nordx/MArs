import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { newGame } from '@mars/simulation';
export function createApp(database?: PrismaClient) {
  let client = database;
  const db = () => (client ??= new PrismaClient());
  const app = Fastify({ logger: true, bodyLimit: 16384 });
  app.addHook('onClose', async () => {
    await client?.$disconnect();
  });
  app.get('/api/health', async () => ({
    status: 'ok',
    stage: 2,
    version: '0.2.2',
  }));
  app.get('/api/ready', async (_request, reply) => {
    try {
      await db().$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'database-unavailable' });
    }
  });
  app.post('/api/new-game', async (request, reply) => {
    const parsed = z
      .object({ seed: z.number().int().min(0).max(2147483647).default(1) })
      .strict()
      .safeParse(request.body ?? {});
    if (!parsed.success)
      return reply.code(400).send({ error: 'Invalid new-game request' });
    return { colony: newGame(parsed.data.seed), persistence: 'none' };
  });
  app.get('/api/auth/session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || authorization.length > 512)
      return reply
        .code(401)
        .send({ error: 'Authentication required', loginAvailable: false });
    const tokenHash = createHash('sha256')
      .update(authorization.slice(7))
      .digest('hex');
    try {
      const session = await db().session.findUnique({ where: { tokenHash } });
      if (!session || session.expiresAt <= new Date())
        return reply.code(401).send({ error: 'Invalid session' });
      return { userId: session.userId };
    } catch {
      return reply
        .code(503)
        .send({ error: 'Authentication storage unavailable' });
    }
  });
  // Token issuance and cloud save routes deliberately await a later stage.
  return app;
}
