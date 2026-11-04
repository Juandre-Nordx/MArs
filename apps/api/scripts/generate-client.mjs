import internals from '@prisma/internals';
const { getGenerators } = internals;
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const registry = require('@prisma/client-generator-registry');
import { fileURLToPath, URL } from 'node:url';
// Prisma's official WASM schema/generator API with the JS PostgreSQL driver.
// Native engines are neither downloaded nor executed; verification is not bypassed.
const generators = await getGenerators({
  registry: registry.defaultRegistry.toInternal(),
  schemaPath: fileURLToPath(
    new URL('../prisma/schema.prisma', import.meta.url),
  ),
  skipDownload: true,
  noEngine: false,
});
try {
  for (const generator of generators) await generator.generate();
} finally {
  for (const generator of generators) generator.stop();
}
