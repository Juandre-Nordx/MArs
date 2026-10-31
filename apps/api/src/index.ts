// Log before loading application dependencies so module/plugin failures are visible.
process.stdout.write(
  JSON.stringify({ event: 'startup_begin', node: process.version }) + '\n',
);
async function main() {
  const { startServer } = await import('./server.js');
  const app = await startServer();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      app.log.info({ event: 'shutdown', signal }, 'Closing HTTP server');
      void app.close().catch(() => {
        process.exitCode = 1;
      });
    });
}
void main().catch((error: unknown) => {
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'STARTUP_FAILED';
  const guidance: Record<string, string> = {
    INVALID_PORT: 'PORT must be an integer between 1 and 65535.',
    WEB_ASSETS_MISSING:
      'Production web assets are missing. Build all workspaces and check WEB_ROOT.',
    EADDRINUSE: 'The configured HTTP port is already in use.',
    ERR_MODULE_NOT_FOUND:
      'A runtime module is missing. Check dependency installation and workspace builds.',
  };
  // Never serialize environment values or arbitrary errors which could contain credentials.
  process.stderr.write(
    JSON.stringify({
      level: 'fatal',
      event: 'startup_failed',
      code,
      message:
        guidance[code] ??
        'HTTP startup failed. Check the build and deployment configuration.',
    }) + '\n',
  );
  process.exitCode = 1;
});
