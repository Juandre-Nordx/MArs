import type { FastifyInstance, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import { z, ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  assetDigest,
  AssetStorageError,
  type AssetStorage,
} from './asset-storage.js';
import {
  oversizedInput,
  prepareArtwork,
  type ArtworkUploadLimits,
} from './artwork-upload.js';
import {
  builtinCatalogue,
  catalogueDocumentSchema,
  catalogueSnapshotSchema,
} from '@mars/simulation';
import {
  AdminError,
  seedCatalogue,
  updateDraft,
  publishDraft,
  draftErrors,
  draftDiff,
} from './admin-store.js';
import {
  hashToken,
  randomToken,
  hashPassword,
  verifyPassword,
  safeEqual,
} from './admin-security.js';
export type AdminOptions = {
  db: () => PrismaClient;
  configured: boolean;
  assetStorage: AssetStorage;
  production?: boolean;
  origin?: string;
  now?: () => number;
  artworkLimits: ArtworkUploadLimits;
  sessionMs?: number;
};
const loginSchema = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
export async function adminRoutes(app: FastifyInstance, options: AdminOptions) {
  await app.register(cookie);
  const now = options.now ?? Date.now;
  const lifetime = options.sessionMs ?? 8 * 60 * 60 * 1000;
  const cookieName = options.production ? '__Host-mars-admin' : 'mars-admin';
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: !!options.production,
    sameSite: 'strict' as const,
    maxAge: Math.floor(lifetime / 1000),
  };
  const origins = options.origin
    ? [options.origin]
    : options.production
      ? []
      : [
          'http://127.0.0.1:5173',
          'http://localhost:5173',
          'http://127.0.0.1:3001',
        ];
  const attempts = new Map<string, { count: number; until: number }>();
  let dummy: Promise<string> | undefined;
  const requireDatabase = () => {
    if (!options.configured)
      throw new AdminError(
        503,
        'Admin database unavailable; browser-local gameplay remains available',
      );
  };
  const originCheck = (request: FastifyRequest) => {
    if (!origins.length)
      throw new AdminError(
        503,
        'Set ADMIN_ORIGIN to the public HTTPS site origin before using administration',
      );
    if (!origins.includes(request.headers.origin ?? ''))
      throw new AdminError(403, 'Untrusted request origin');
  };
  async function authorise(request: FastifyRequest, write = false) {
    requireDatabase();
    const token = request.cookies[cookieName];
    if (!token) throw new AdminError(401, 'Administrator login required');
    const session = await options.db().adminSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt.getTime() <= now())
      throw new AdminError(401, 'Admin session expired');
    if (!session.user.enabled || session.user.role !== 'ADMIN')
      throw new AdminError(403, 'Administrator permission required');
    if (write) {
      originCheck(request);
      if (
        !safeEqual(
          String(request.headers['x-csrf-token'] ?? ''),
          session.csrfToken,
        )
      )
        throw new AdminError(403, 'Invalid CSRF token');
    }
    return session;
  }
  // All admin errors are bounded and sanitised; database details and credential values never leave the server.
  await app.register(async (routes) => {
    routes.setErrorHandler((error, request, reply) => {
      if (error instanceof AdminError || error instanceof AssetStorageError)
        return reply.code(error.statusCode).send({ error: error.message });
      if (error instanceof ZodError)
        return reply.code(422).send({
          error: 'Validation failed',
          issues: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      if (error.statusCode === 413 || error.statusCode === 400)
        return reply.code(error.statusCode).send({
          error:
            error.statusCode === 413
              ? request.routeOptions.url === '/api/admin/assets'
                ? oversizedInput(options.artworkLimits).message
                : 'Upload too large'
              : 'Invalid request',
        });
      return reply.code(503).send({
        error:
          'Admin database unavailable; browser-local gameplay remains available',
      });
    });
    routes.addHook('onSend', async (_req, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      return payload;
    });
    routes.post('/api/admin/login', async (req, reply) => {
      requireDatabase();
      originCheck(req);
      const key = req.ip;
      const record = attempts.get(key);
      if (record && record.until > now() && record.count >= 5) {
        reply.header('Retry-After', Math.ceil((record.until - now()) / 1000));
        throw new AdminError(429, 'Too many login attempts; retry later');
      }
      if (attempts.size > 10000) {
        for (const [k, v] of attempts) if (v.until <= now()) attempts.delete(k);
        if (attempts.size > 10000)
          attempts.delete(attempts.keys().next().value!);
      }
      attempts.set(key, {
        count: record && record.until > now() ? record.count + 1 : 1,
        until:
          record && record.until > now()
            ? record.until
            : now() + 15 * 60 * 1000,
      });
      const body = loginSchema.parse(req.body);
      const user = await options
        .db()
        .user.findUnique({ where: { email: body.email } });
      dummy ??= hashPassword(randomToken());
      const valid = await verifyPassword(
        body.password,
        user?.passwordHash ?? (await dummy),
      );
      if (!valid || !user || !user.enabled || user.role !== 'ADMIN')
        throw new AdminError(401, 'Invalid administrator credentials');
      const token = randomToken(),
        csrfToken = randomToken();
      await options.db().adminSession.create({
        data: {
          tokenHash: hashToken(token),
          csrfToken,
          userId: user.id,
          expiresAt: new Date(now() + lifetime),
        },
      });
      reply.setCookie(cookieName, token, cookieOptions);
      return {
        email: user.email,
        csrfToken,
        expiresAt: new Date(now() + lifetime).toISOString(),
      };
    });
    routes.get('/api/admin/session', async (req) => {
      const session = await authorise(req);
      return {
        email: session.user.email,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      };
    });
    routes.post('/api/admin/logout', async (req, reply) => {
      const s = await authorise(req, true);
      await options.db().adminSession.delete({ where: { id: s.id } });
      reply.clearCookie(cookieName, { ...cookieOptions, maxAge: 0 });
      return { status: 'logged-out' };
    });
    routes.post('/api/admin/password', async (req, reply) => {
      const s = await authorise(req, true);
      const body = z
        .object({
          current: z.string().max(128),
          password: z.string().min(12).max(128),
        })
        .strict()
        .parse(req.body);
      if (!(await verifyPassword(body.current, s.user.passwordHash ?? '')))
        throw new AdminError(403, 'Current password did not match');
      await options.db().$transaction(async (tx) => {
        await tx.user.update({
          where: { id: s.userId },
          data: { passwordHash: await hashPassword(body.password) },
        });
        await tx.adminSession.deleteMany({ where: { userId: s.userId } });
        await tx.adminAudit.create({
          data: {
            actorId: s.userId,
            action: 'admin.password-change',
            detail: { sessionsRevoked: true },
          },
        });
      });
      reply.clearCookie(cookieName, { ...cookieOptions, maxAge: 0 });
      return { status: 'password-changed; sign in again' };
    });
    routes.get('/api/admin/catalogue', async (req) => {
      await authorise(req);
      const db = options.db(),
        draft = await db.catalogueDraft.findUnique({ where: { id: 'main' } }),
        state = await db.catalogueState.findUnique({ where: { id: 'main' } });
      const current = state?.currentVersion
        ? await db.publishedCatalogue.findUnique({
            where: { id: state.currentVersion },
          })
        : null;
      const document = draft
        ? catalogueDocumentSchema.parse(draft.document)
        : null;
      return {
        draft,
        current,
        artworkLimits: options.artworkLimits,
        errors: document ? await draftErrors(db, document) : [],
        diff: document
          ? draftDiff(
              current
                ? catalogueDocumentSchema.parse(current.document)
                : builtinCatalogue().document,
              document,
            )
          : [],
        history: await db.publishedCatalogue.findMany({
          select: { id: true, digest: true, createdAt: true },
          orderBy: { id: 'desc' },
          take: 100,
        }),
      };
    });
    routes.post('/api/admin/seed', async (req) => {
      const s = await authorise(req, true);
      return seedCatalogue(options.db(), s.userId);
    });
    routes.post('/api/admin/entries', async (req) => {
      const s = await authorise(req, true);
      const body = z
        .object({
          revision: z.number().int().positive(),
          kind: z.enum(['resources', 'buildings', 'recipes']),
          create: z.boolean(),
          entry: z.unknown(),
        })
        .strict()
        .parse(req.body);
      return updateDraft(
        options.db(),
        s.userId,
        body.revision,
        body.kind,
        body.entry,
        body.create,
      );
    });
    routes.post('/api/admin/validate', async (req) => {
      await authorise(req, true);
      const draft = await options
        .db()
        .catalogueDraft.findUnique({ where: { id: 'main' } });
      if (!draft) throw new AdminError(409, 'Initialise the draft first');
      return {
        revision: draft.revision,
        errors: await draftErrors(
          options.db(),
          catalogueDocumentSchema.parse(draft.document),
          options.assetStorage,
        ),
      };
    });
    routes.post('/api/admin/publish', async (req) => {
      const s = await authorise(req, true);
      const body = z
        .object({ revision: z.number().int().positive() })
        .strict()
        .parse(req.body);
      return publishDraft(
        options.db(),
        s.userId,
        body.revision,
        options.assetStorage,
      );
    });
    routes.get('/api/admin/audit', async (req) => {
      await authorise(req);
      return options
        .db()
        .adminAudit.findMany({ orderBy: { id: 'desc' }, take: 200 });
    });
    routes.post(
      '/api/admin/assets',
      { bodyLimit: 4 * Math.ceil(options.artworkLimits.inputBytes / 3) + 2048 },
      async (req) => {
        const s = await authorise(req, true);
        const body = z
          .object({
            slot: z.enum(['resource-icon', 'building-icon', 'building-sprite']),
            data: z.string(),
          })
          .strict()
          .parse(req.body);
        const {
          data: bytes,
          info: { width, height },
        } = await prepareArtwork(
          body.data,
          body.slot !== 'building-sprite',
          options.artworkLimits,
        );

        const id = randomUUID();
        const payload = await options.assetStorage.store(id, bytes);
        try {
          await options.db().$transaction(async (tx) => {
            await tx.catalogueAsset.create({
              data: {
                id,
                slot: body.slot,
                mime: 'image/png',
                width,
                height,
                digest: assetDigest(bytes),
                ...payload,
              },
            });
            await tx.adminAudit.create({
              data: {
                actorId: s.userId,
                action: 'asset.upload',
                detail: { id, slot: body.slot, width, height },
              },
            });
          });
        } catch {
          // A connection failure may leave the commit outcome unknown. Retain the
          // file so a committed record can never reference bytes we removed.
          req.log.warn({
            event: 'asset_upload_metadata_failed',
            assetId: id,
            storageBackend: payload.storageBackend,
          });
          throw new AdminError(
            503,
            'Artwork upload could not confirm its database record. Retry the upload when the database is available.',
          );
        }
        return { id, slot: body.slot, width, height };
      },
    );
    routes.get('/api/admin/assets/:id', async (req, reply) => {
      await authorise(req);
      const id = z
        .string()
        .uuid()
        .parse((req.params as { id: string }).id);
      const asset = await options
        .db()
        .catalogueAsset.findUnique({ where: { id } });
      if (!asset) throw new AdminError(404, 'Asset not found');
      return reply
        .type(asset.mime)
        .send(await options.assetStorage.read(asset, asset.data));
    });
  });
  async function snapshot(version?: string) {
    if (version === 'builtin-v0331') return builtinCatalogue();
    if (!options.configured) {
      if (version)
        throw new AdminError(
          503,
          `Catalogue ${version} cannot be resolved without its database`,
        );
      return builtinCatalogue();
    }
    const db = options.db();
    let id: number | undefined;
    if (version) {
      if (!/^published-[1-9][0-9]*$/.test(version))
        throw new AdminError(404, 'Unknown catalogue version');
      id = Number(version.slice(10));
    } else
      id =
        (await db.catalogueState.findUnique({ where: { id: 'main' } }))
          ?.currentVersion ?? undefined;
    if (!id) return builtinCatalogue();
    const found = await db.publishedCatalogue.findUnique({ where: { id } });
    if (!found)
      throw new AdminError(
        404,
        `Catalogue ${version ?? id} not found; no substitution made`,
      );
    return catalogueSnapshotSchema.parse({
      id: `published-${id}`,
      document: found.document,
    });
  }
  app.get('/api/catalogues', async (_req, reply) => {
    try {
      if (!options.configured) return [];
      return (
        await options.db().publishedCatalogue.findMany({
          select: { id: true },
          orderBy: { id: 'desc' },
          take: 100,
        })
      ).map((v) => ({ id: `published-${v.id}` }));
    } catch {
      return reply.code(503).send({ error: 'Catalogue database unavailable' });
    }
  });
  app.get('/api/catalogues/:version', async (req, reply) => {
    try {
      return await snapshot(
        (req.params as { version: string }).version === 'current'
          ? undefined
          : (req.params as { version: string }).version,
      );
    } catch (e) {
      return reply.code(e instanceof AdminError ? e.statusCode : 503).send({
        error:
          e instanceof AdminError
            ? e.message
            : 'Catalogue database unavailable; use a saved embedded snapshot',
      });
    }
  });
  app.get('/api/catalogue-assets/:id', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    const id = z
      .string()
      .uuid()
      .safeParse((req.params as { id: string }).id);
    if (!id.success)
      return reply
        .header('Cache-Control', 'no-store')
        .code(404)
        .send({ error: 'Published asset not found' });
    try {
      requireDatabase();
      const asset = await options.db().catalogueAsset.findFirst({
        where: { id: id.data, versions: { some: {} } },
      });
      if (!asset) throw new AdminError(404, 'Published asset not found');
      const bytes = await options.assetStorage.read(asset, asset.data);
      return reply
        .header('Cache-Control', 'public,max-age=31536000,immutable')
        .type(asset.mime)
        .send(bytes);
    } catch (error) {
      const status =
        error instanceof AdminError || error instanceof AssetStorageError
          ? error.statusCode
          : 503;
      const message =
        error instanceof AssetStorageError || status === 404
          ? (error as Error).message
          : 'Asset unavailable';
      return reply
        .header('Cache-Control', 'no-store')
        .code(status)
        .send({ error: message });
    }
  });
  return { snapshot };
}
