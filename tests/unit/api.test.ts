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
