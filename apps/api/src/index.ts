import { createApp } from './app.js';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const app = createApp();
const webRoot = resolve(process.cwd(), process.env.WEB_ROOT ?? '../web/dist');
if (existsSync(webRoot)) await app.register(fastifyStatic, { root: webRoot });
const port = Number(process.env.PORT ?? 3001);
try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close();
  });
