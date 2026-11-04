import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../../apps/api/src/app.js';
import { databaseClient } from '../../apps/api/src/database.js';
import {
  hashPassword,
  hashToken,
  randomToken,
  verifyPassword,
} from '../../apps/api/src/admin-security.js';
import { builtinCatalogue, type CatalogueDocument } from '@mars/simulation';
const url = process.env.MARS_TEST_DATABASE_URL;
const origin = 'http://127.0.0.1:5173';
it('hashes administrator passwords with independent salts and verifies safely', async () => {
  const p = randomToken(),
    a = await hashPassword(p),
    b = await hashPassword(p);
  expect(a).not.toBe(b);
  expect(a).not.toContain(p);
  expect(await verifyPassword(p, a)).toBe(true);
  expect(await verifyPassword('incorrect', a)).toBe(false);
  expect(await verifyPassword(p, 'invalid')).toBe(false);
  await expect(hashPassword('short')).rejects.toThrow();
});
describe.skipIf(!url)('admin against isolated PostgreSQL', () => {
  const db = databaseClient(url!);
  let app: ReturnType<typeof createApp>;
  let userId = '';
  const password = randomToken();
  const email = `admin-${randomUUID()}@example.test`;
  let time = Date.now(),
    ip = 0;
  const headers = { origin };
  const login = async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      remoteAddress: `10.10.0.${++ip}`,
      headers,
      payload: { email, password },
    });
    expect(r.statusCode, r.body).toBe(200);
    return {
      cookie: r.headers['set-cookie']!.toString().split(';')[0]!,
      origin,
      'x-csrf-token': r.json().csrfToken,
    };
  };
  const post = (path: string, payload: unknown, auth: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: `/api/admin/${path}`,
      headers: auth,
      payload,
    });
  const catalogue = async (auth: Record<string, string>) =>
    (
      await app.inject({ url: '/api/admin/catalogue', headers: auth })
    ).json() as {
      draft: { revision: number; document: CatalogueDocument };
      current: { id: number } | null;
      errors: string[];
    };
  function createInitial(address: string, secret: string) {
    return new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', 'apps/api/src/create-admin.ts', address],
        {
          env: { ...process.env, DATABASE_URL: url },
          stdio: ['pipe', 'ignore', 'ignore'],
        },
      );
      child.once('error', reject);
      child.once('close', resolve);
      child.stdin.end(secret + '\n');
    });
  }
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
      !['/mars_v04', '/mars_test'].includes(parsed.pathname)
    )
      throw new Error(
        'Destructive integration fixture requires a local mars_v04 or mars_test database',
      );
    await db.$executeRawUnsafe(
      'TRUNCATE "AdminAudit", "PublishedAsset", "PublishedCatalogue", "CatalogueAsset", "CatalogueState", "CatalogueDraft", "RecipeReference", "RecipeDefinition", "BuildingDefinition", "ResourceDefinition", "User" RESTART IDENTITY CASCADE',
    );
    const code = await createInitial(email, password);
    expect(code).toBe(0);
    userId = (await db.user.findUniqueOrThrow({ where: { email } })).id;
    app = createApp(undefined, {
      databaseUrl: url,
      logger: false,
      admin: { origin, now: () => time },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });
  it('creates the initial administrator through the private-stdin CLI and refuses additional provisioning', async () => {
    const admin = await db.user.findUniqueOrThrow({ where: { email } });
    expect(admin.role).toBe('ADMIN');
    expect(await verifyPassword(password, admin.passwordHash!)).toBe(true);
    expect(
      await createInitial(`second-${randomUUID()}@example.test`, randomToken()),
    ).toBe(1);
    expect(await db.user.count({ where: { role: 'ADMIN' } })).toBe(1);
  });
  it('rejects missing/ordinary-player permissions on every protected endpoint', async () => {
    const player = await db.user.create({
      data: { email: `player-${randomUUID()}@example.test` },
    });
    const token = randomToken();
    await db.adminSession.create({
      data: {
        userId: player.id,
        tokenHash: hashToken(token),
        csrfToken: randomToken(),
        expiresAt: new Date(time + 100000),
      },
    });
    for (const [method, path] of [
      ['GET', 'session'],
      ['GET', 'catalogue'],
      ['GET', 'audit'],
      ['GET', `assets/${randomUUID()}`],
      ['POST', 'logout'],
      ['POST', 'password'],
      ['POST', 'seed'],
      ['POST', 'entries'],
      ['POST', 'validate'],
      ['POST', 'publish'],
      ['POST', 'assets'],
    ] as const) {
      for (const [cookie, status] of [
        ['', 401],
        [`mars-admin=${token}`, 403],
      ] as const) {
        const r = await app.inject({
          method,
          url: `/api/admin/${path}`,
          headers: { origin, cookie },
          ...(method === 'POST' ? { payload: {} } : {}),
        });
        expect(r.statusCode, `${method} ${path}: ${r.body}`).toBe(status);
      }
    }
  });
  it('uses expiring hashed sessions, CSRF/origin checks, and working logout', async () => {
    const auth = await login();
    const token = auth.cookie.slice('mars-admin='.length);
    const stored = await db.adminSession.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
    });
    expect(stored.tokenHash).not.toBe(token);
    expect(
      (await app.inject({ url: '/api/admin/session', headers: auth }))
        .statusCode,
    ).toBe(200);
    expect(
      (await post('seed', {}, { ...auth, 'x-csrf-token': '' })).statusCode,
    ).toBe(403);
    expect(
      (await post('seed', {}, { ...auth, origin: 'https://attacker.test' }))
        .statusCode,
    ).toBe(403);
    const seeded = await post('seed', {}, auth);
    expect(seeded.statusCode, seeded.body).toBe(200);
    time += 8 * 60 * 60 * 1000 + 1;
    expect(
      (await app.inject({ url: '/api/admin/session', headers: auth }))
        .statusCode,
    ).toBe(401);
    const valid = await login();
    expect((await post('logout', {}, valid)).statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/api/admin/session', headers: valid }))
        .statusCode,
    ).toBe(401);
  });
  it('sets production cookie flags and rate limits invalid logins', async () => {
    const prod = createApp(undefined, {
      databaseUrl: url,
      logger: false,
      admin: { origin: 'https://mars.example', production: true },
    });
    const response = await prod.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin: 'https://mars.example' },
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toMatch(
      /__Host-mars-admin=.*HttpOnly; Secure; SameSite=Strict/,
    );
    await prod.close();
    for (let i = 0; i < 6; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        remoteAddress: '10.0.0.250',
        headers,
        payload: { email, password: 'wrong' },
      });
      expect(r.statusCode).toBe(i === 5 ? 429 : 401);
    }
  });
  it('seeds only once, validates references/IDs and preserves edits on conflict', async () => {
    const auth = await login();
    let c = await catalogue(auth);
    const resource = {
      ...c.draft.document.resources[0]!,
      name: 'Draft-only water',
    };
    const saved = await post(
      'entries',
      {
        revision: c.draft.revision,
        kind: 'resources',
        create: false,
        entry: resource,
      },
      auth,
    );
    expect(saved.statusCode, saved.body).toBe(200);
    const repeat = await post('seed', {}, auth);
    expect(repeat.json().document.resources[0].name).toBe('Draft-only water');
    const pub = await app.inject('/api/catalogues/current');
    expect(pub.json().document.resources[0].name).toBe(
      builtinCatalogue().document.resources[0]!.name,
    );
    expect(
      (
        await post(
          'entries',
          {
            revision: c.draft.revision,
            kind: 'resources',
            create: false,
            entry: resource,
          },
          auth,
        )
      ).statusCode,
    ).toBe(409);
    c = await catalogue(auth);
    expect(
      (
        await post(
          'entries',
          {
            revision: c.draft.revision,
            kind: 'resources',
            create: true,
            entry: resource,
          },
          auth,
        )
      ).statusCode,
    ).toBe(409);
    const recipe = {
      ...c.draft.document.recipes[0]!,
      inputs: [{ resourceId: 'unknown', quantity: 1 }],
    };
    expect(
      (
        await post(
          'entries',
          {
            revision: c.draft.revision,
            kind: 'recipes',
            create: false,
            entry: recipe,
          },
          auth,
        )
      ).statusCode,
    ).toBe(422);
    const responses = await Promise.all(
      ['A', 'B'].map((name) =>
        post(
          'entries',
          {
            revision: c.draft.revision,
            kind: 'resources',
            create: false,
            entry: { ...resource, name },
          },
          auth,
        ),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });
  it('validates uploads, hides drafts, atomically publishes assets and retains immutable history', async () => {
    const auth = await login();
    expect(
      (
        await post(
          'assets',
          {
            slot: 'building-sprite',
            data: Buffer.from('not a model or PNG').toString('base64'),
          },
          auth,
        )
      ).statusCode,
    ).toBe(415);
    const tiny = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#d05020' },
    })
      .png()
      .toBuffer();
    expect(
      (
        await post(
          'assets',
          { slot: 'resource-icon', data: tiny.toString('base64') },
          auth,
        )
      ).statusCode,
    ).toBe(422);
    const image = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 50, g: 140, b: 160, alpha: 0.5 },
      },
    })
      .webp()
      .toBuffer();
    const uploaded = await post(
      'assets',
      { slot: 'resource-icon', data: image.toString('base64') },
      auth,
    );
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    const id = uploaded.json().id;
    expect((await app.inject(`/api/catalogue-assets/${id}`)).statusCode).toBe(
      404,
    );
    expect(
      (await app.inject({ url: `/api/admin/assets/${id}`, headers: auth }))
        .headers['content-type'],
    ).toBe('image/png');
    let c = await catalogue(auth);
    expect(
      (
        await post(
          'entries',
          {
            revision: c.draft.revision,
            kind: 'resources',
            create: false,
            entry: { ...c.draft.document.resources[0]!, icon: id },
          },
          auth,
        )
      ).statusCode,
    ).toBe(200);
    c = await catalogue(auth);
    expect(c.errors).toEqual([]);
    const results = await Promise.all([
      post('publish', { revision: c.draft.revision }, auth),
      post('publish', { revision: c.draft.revision }, auth),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const version = results.find((r) => r.statusCode === 200)!.json().id;
    const snapshot = (
      await app.inject(`/api/catalogues/published-${version}`)
    ).json();
    expect(snapshot.document.resources[0].icon).toBe(id);
    expect((await app.inject(`/api/catalogue-assets/${id}`)).statusCode).toBe(
      200,
    );
    await expect(
      db.publishedCatalogue.update({
        where: { id: version },
        data: { digest: 'tamper' },
      }),
    ).rejects.toThrow();
    await expect(db.catalogueAsset.delete({ where: { id } })).rejects.toThrow();
    await expect(
      db.publishedAsset.delete({
        where: { versionId_assetId: { versionId: version, assetId: id } },
      }),
    ).rejects.toThrow();
    await expect(
      db.adminAudit.update({ where: { id: 1 }, data: { action: 'tamper' } }),
    ).rejects.toThrow();
    c = await catalogue(auth);
    await post(
      'entries',
      {
        revision: c.draft.revision,
        kind: 'resources',
        create: false,
        entry: {
          ...c.draft.document.resources[0]!,
          icon: 'placeholder:resource',
        },
      },
      auth,
    );
    c = await catalogue(auth);
    expect(
      (await post('publish', { revision: c.draft.revision }, auth)).statusCode,
    ).toBe(200);
    expect(
      (await app.inject(`/api/catalogues/published-${version}`)).json(),
    ).toEqual(snapshot);
    expect((await app.inject(`/api/catalogue-assets/${id}`)).statusCode).toBe(
      200,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/new-game',
          payload: { catalogueVersion: `published-${version}` },
        })
      ).json().colony.catalogue,
    ).toEqual(snapshot);
  });
  it('keeps invalid drafts private and rolls publication back without partial state', async () => {
    const auth = await login();
    let c = await catalogue(auth);
    const before = c.current!.id;
    const original = c.draft.document.resources[0]!;
    await post(
      'entries',
      {
        revision: c.draft.revision,
        kind: 'resources',
        create: false,
        entry: { ...original, unit: 'MW' },
      },
      auth,
    );
    c = await catalogue(auth);
    expect(c.errors.join()).toMatch(/unit conversion/);
    expect(
      (await post('publish', { revision: c.draft.revision }, auth)).statusCode,
    ).toBe(422);
    expect((await catalogue(auth)).current!.id).toBe(before);
    expect(
      (await app.inject('/api/catalogues/current')).json().document.resources[0]
        .unit,
    ).toBe('kg');
    await post(
      'entries',
      {
        revision: c.draft.revision,
        kind: 'resources',
        create: false,
        entry: original,
      },
      auth,
    );
  });
  it('audits edits/publications and revokes every session on password change', async () => {
    const auth = await login(),
      other = await login();
    const audit = await app.inject({ url: '/api/admin/audit', headers: auth });
    expect(audit.json().map((a: { action: string }) => a.action)).toContain(
      'catalogue.publish',
    );
    expect(JSON.stringify(audit.json())).not.toContain(password);
    expect(
      (
        await post(
          'password',
          { current: password, password: randomToken() },
          auth,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/admin/session', headers: other }))
        .statusCode,
    ).toBe(401);
    expect(await db.adminSession.count({ where: { userId } })).toBe(0);
  });
});
it('reports admin/database unavailability while local colonies and explicit built-in catalogues still work', async () => {
  const app = createApp(undefined, {
    databaseUrl: 'postgresql://test@127.0.0.1:1/unavailable',
    logger: false,
    admin: { origin },
  });
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/login',
          headers: { origin },
          payload: { email: 'test@example.test', password: 'anything' },
        })
      ).statusCode,
    ).toBe(503);
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    const game = await app.inject({
      method: 'POST',
      url: '/api/new-game',
      payload: {},
    });
    expect(game.statusCode).toBe(200);
    expect(game.json().warning).toMatch(/built-in/);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/new-game',
          payload: { catalogueVersion: 'published-1' },
        })
      ).statusCode,
    ).toBe(503);
    expect((await app.inject('/api/catalogues/builtin-v0331')).statusCode).toBe(
      200,
    );
  } finally {
    await app.close();
  }
});
