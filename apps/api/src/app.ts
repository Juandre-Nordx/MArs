import Fastify, { type FastifyServerOptions } from 'fastify';
import { databaseClient } from './database.js';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { adminRoutes, type AdminOptions } from './admin.js';
import { AdminError } from './admin-store.js';
import { builtinCatalogue, newGame } from '@mars/simulation';
export function createApp(
  database?: PrismaClient,
  options: {
    databaseUrl?: string;
    logger?: FastifyServerOptions['logger'];
    admin?: Partial<Omit<AdminOptions, 'db' | 'configured'>>;
  } = {},
) {
  let client = database;
  const databaseUrl = Object.hasOwn(options, 'databaseUrl')
    ? options.databaseUrl
    : process.env.DATABASE_URL;
  const configured = !!database || !!databaseUrl;
  const db = () => (client ??= databaseClient(databaseUrl!));
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 16384 });
  let lastFailure = '';
  const reportDatabaseFailure = (event: string, error: unknown) => {
    const details =
      error && typeof error === 'object'
        ? (error as { code?: unknown; errorCode?: unknown })
        : {};
    const candidate = details.code ?? details.errorCode;
    const code =
      typeof candidate === 'string' && /^P[0-9]{4}$/.test(candidate)
        ? candidate
        : 'DATABASE_UNAVAILABLE';
    if (lastFailure !== code) {
      app.log.error(
        { event, code },
        'Database unavailable; browser-local gameplay remains available. Check DATABASE_URL, database connectivity and applied migrations.',
      );
      lastFailure = code;
    }
  };
  app.addHook('onClose', async () => {
    await client?.$disconnect();
  });
  app.get('/api/health', async () => ({
    status: 'ok',
    stage: 3,
    version: '0.4.0',
  }));
  app.get('/api/ready', async (_request, reply) => {
    if (!configured) {
      if (lastFailure !== 'DATABASE_UNCONFIGURED') {
        app.log.warn(
          { event: 'database_readiness_failed', code: 'DATABASE_UNCONFIGURED' },
          'DATABASE_URL is not configured; browser-local gameplay remains available.',
        );
        lastFailure = 'DATABASE_UNCONFIGURED';
      }
      return reply.code(503).send({ status: 'database-unconfigured' });
    }
    try {
      await db().$queryRaw`SELECT 1`;
      if (lastFailure)
        app.log.info(
          { event: 'database_ready' },
          'Database connectivity recovered',
        );
      lastFailure = '';
      return { status: 'ready' };
    } catch (error) {
      reportDatabaseFailure('database_readiness_failed', error);
      return reply.code(503).send({ status: 'database-unavailable' });
    }
  });
  app.register(async (routes) => {
    const { snapshot } = await adminRoutes(routes, {
      db,
      configured,
      production: process.env.NODE_ENV === 'production',
      origin: process.env.ADMIN_ORIGIN,
      uploadLimit: Number(process.env.ADMIN_UPLOAD_LIMIT_BYTES) || undefined,
      ...options.admin,
    });
    routes.post('/api/new-game', async (request, reply) => {
      const parsed = z
        .object({
          seed: z.number().int().min(0).max(2147483647).default(1),
          catalogueVersion: z.string().max(100).optional(),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: 'Invalid new-game request' });
      try {
        return {
          colony: newGame(
            parsed.data.seed,
            'central',
            await snapshot(parsed.data.catalogueVersion),
          ),
          persistence: 'none',
        };
      } catch (error) {
        if (parsed.data.catalogueVersion)
          return reply
            .code(error instanceof AdminError ? error.statusCode : 503)
            .send({
              error:
                error instanceof AdminError
                  ? error.message
                  : 'Required catalogue unavailable; no version substitution made',
            });
        reportDatabaseFailure('catalogue_storage_failed', error);
        return {
          colony: newGame(parsed.data.seed, 'central', builtinCatalogue()),
          persistence: 'none',
          warning:
            'Catalogue database unavailable. This new colony uses the original built-in catalogue.',
        };
      }
    });
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
    if (!configured)
      return reply
        .code(503)
        .send({ error: 'Authentication storage unavailable' });
    try {
      const session = await db().session.findUnique({ where: { tokenHash } });
      if (!session || session.expiresAt <= new Date())
        return reply.code(401).send({ error: 'Invalid session' });
      return { userId: session.userId };
    } catch (error) {
      reportDatabaseFailure('authentication_storage_failed', error);
      return reply
        .code(503)
        .send({ error: 'Authentication storage unavailable' });
    }
  });
  // Token issuance and cloud save routes deliberately await a later stage.
  return app;
}
