import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
it('creates a validated in-memory colony and rejects malformed input', async () => {
  const app = createApp();
  apps.push(app);
  const response = await app.inject({
    method: 'POST',
    url: '/api/new-game',
    payload: { seed: 42 },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().colony).toMatchObject({
    schemaVersion: 5,
    seed: 42,
    tick: 0,
  });
  expect(response.json().persistence).toBe('none');
  for (const payload of [{ seed: -1 }, { seed: '1' }, { unexpected: true }]) {
    expect(
      (await app.inject({ method: 'POST', url: '/api/new-game', payload }))
        .statusCode,
    ).toBe(400);
  }
});
it('reports process health and rejects missing authentication', async () => {
  const app = createApp();
  apps.push(app);
  expect((await app.inject('/api/health')).statusCode).toBe(200);
  expect((await app.inject('/api/auth/session')).statusCode).toBe(401);
});
it('keeps gameplay healthy without a configured database and explicitly rejects database readiness/authentication', async () => {
  const app = createApp(undefined, { databaseUrl: undefined, logger: false });
  apps.push(app);
  expect((await app.inject('/api/health')).statusCode).toBe(200);
  expect((await app.inject('/api/ready')).json()).toEqual({
    status: 'database-unconfigured',
  });
  expect((await app.inject('/api/ready')).statusCode).toBe(503);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/new-game',
        payload: { seed: 1 },
      })
    ).statusCode,
  ).toBe(200);
  const auth = await app.inject({
    url: '/api/auth/session',
    headers: { authorization: 'Bearer test-token' },
  });
  expect(auth.statusCode).toBe(503);
});
it('reports unavailable database safely, logs recovery and retains strict readiness semantics', async () => {
  const { vi } = await import('vitest');
  const output: string[] = [];
  const query = vi
    .fn()
    .mockRejectedValueOnce(
      Object.assign(
        new Error('postgresql://private-user:secret-password@internal-db'),
        { errorCode: 'P1001' },
      ),
    )
    .mockResolvedValue([]);
  const database = {
    $queryRaw: query,
    $disconnect: vi.fn().mockResolvedValue(undefined),
    session: {
      findUnique: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('secret-password'), { code: 'P2021' }),
        ),
    },
  };
  const app = createApp(
    database as unknown as import('@prisma/client').PrismaClient,
    {
      logger: {
        stream: {
          write: (line: string) => {
            output.push(line);
          },
        },
      },
    },
  );
  apps.push(app);
  expect((await app.inject('/api/ready')).statusCode).toBe(503);
  expect((await app.inject('/api/health')).statusCode).toBe(200);
  expect((await app.inject('/api/ready')).json()).toEqual({ status: 'ready' });
  expect(
    (
      await app.inject({
        url: '/api/auth/session',
        headers: { authorization: 'Bearer test-token' },
      })
    ).statusCode,
  ).toBe(503);
  const logs = output.join('');
  expect(logs).toContain('P1001');
  expect(logs).toContain('database_ready');
  expect(logs).toContain('P2021');
  expect(logs).not.toContain('secret-password');
  expect(logs).not.toContain('private-user');
});
