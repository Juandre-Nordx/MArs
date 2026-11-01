import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout } from 'node:timers';
const entry = fileURLToPath(
  new URL('../apps/api/dist/index.js', import.meta.url),
);
const temporary = await mkdtemp(join(tmpdir(), 'mars-production-'));
async function freePort() {
  const s = createServer();
  await new Promise((r, j) => {
    s.once('error', j);
    s.listen(0, '127.0.0.1', r);
  });
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}
function launch(extra = {}) {
  const env = { ...process.env, NODE_ENV: 'production', ...extra };
  delete env.DATABASE_URL;
  delete env.WEB_ROOT;
  Object.assign(env, extra);
  const child = spawn(process.execPath, [entry], {
    cwd: temporary,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => {
    output += d;
  });
  child.stderr.on('data', (d) => {
    output += d;
  });
  const exited = once(child, 'exit');
  return { child, exited, output: () => output };
}
async function stop(run) {
  if (run.child.exitCode === null) {
    run.child.kill('SIGTERM');
    const result = await Promise.race([
      run.exited,
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), 5000);
        timer.unref();
      }),
    ]);
    if (result === 'timeout') {
      run.child.kill('SIGKILL');
      throw new Error('Production process did not shut down cleanly');
    }
    assert.equal(result[0], 0, run.output());
  }
}
async function waitForServer(run, port) {
  for (let i = 0; i < 100; i++) {
    if (run.child.exitCode !== null)
      throw new Error(`Startup exited early: ${run.output()}`);
    try {
      const r = await globalThis.fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch {
      /* Wait for binding. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Production startup timed out: ${run.output()}`);
}
try {
  for (const configured of [false, true]) {
    const port = await freePort(),
      run = launch({
        PORT: String(port),
        ...(configured
          ? { DATABASE_URL: 'invalid://fixture-do-not-log-this' }
          : {}),
      });
    try {
      await waitForServer(run, port);
      const base = `http://127.0.0.1:${port}`;
      const html = await globalThis.fetch(base).then((r) => {
        assert.equal(r.status, 200);
        return r.text();
      });
      const script = html.match(/src="([^"]+\.js)"/);
      assert.ok(script, 'Built HTML has no JS bundle');
      assert.equal(
        (await globalThis.fetch(new URL(script[1], base))).status,
        200,
      );
      assert.equal((await globalThis.fetch(`${base}/api/ready`)).status, 503);
      assert.equal((await globalThis.fetch(`${base}/api/health`)).status, 200);
      const response = await globalThis.fetch(`${base}/api/new-game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: 42 }),
      });
      assert.equal(response.status, 200);
      const game = await response.json();
      assert.equal(game.colony.schemaVersion, 5);
      assert.equal(game.colony.world.width, 512);
      assert.ok(run.output().includes('startup_complete'));
      assert.ok(!run.output().includes('fixture-do-not-log-this'));
      console.log(
        `PASS production HTML/assets, health and new game with ${configured ? 'invalid' : 'no'} DATABASE_URL, launched outside repository`,
      );
    } finally {
      await stop(run);
    }
  }
  for (const [env, code] of [
    [{ PORT: 'invalid-fixture-do-not-log-this' }, 'INVALID_PORT'],
    [
      { PORT: String(await freePort()), WEB_ROOT: temporary },
      'WEB_ASSETS_MISSING',
    ],
  ]) {
    const run = launch(env);
    const [exit] = await run.exited;
    assert.equal(exit, 1);
    assert.ok(run.output().includes('startup_begin'));
    assert.ok(run.output().includes('startup_failed'));
    assert.ok(run.output().includes(code));
    assert.ok(!run.output().includes('fixture-do-not-log-this'));
    console.log(`PASS explicit fatal startup diagnostics: ${code}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
