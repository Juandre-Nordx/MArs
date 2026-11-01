import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
export class StartupError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'StartupError';
  }
}
export async function startServer(env: NodeJS.ProcessEnv = process.env) {
  const rawPort = env.PORT ?? '3001';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) > 65535 || Number(rawPort) < 1)
    throw new StartupError('INVALID_PORT');
  // Works from both compiled and source modules, regardless of the launch directory.
  const webRoot = env.WEB_ROOT
    ? resolve(env.WEB_ROOT)
    : fileURLToPath(new URL('../../web/dist/', import.meta.url));
  const hasWeb = existsSync(resolve(webRoot, 'index.html'));
  if (env.NODE_ENV === 'production' && !hasWeb)
    throw new StartupError('WEB_ASSETS_MISSING');
  const app = createApp(undefined, { databaseUrl: env.DATABASE_URL });
  try {
    app.log.info(
      {
        event: 'startup_configuration',
        port: Number(rawPort),
        webAssets: hasWeb,
        database: env.DATABASE_URL ? 'configured' : 'unconfigured',
        persistence: 'browser-local',
      },
      'Starting MARS HTTP server',
    );
    if (hasWeb) await app.register(fastifyStatic, { root: webRoot });
    await app.listen({ port: Number(rawPort), host: '0.0.0.0' });
    app.log.info(
      { event: 'startup_complete', healthcheck: '/api/health' },
      'MARS is accepting requests',
    );
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
