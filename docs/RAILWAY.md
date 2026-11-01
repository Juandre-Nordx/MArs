# Railway deployment

1. Add a Railway service from this GitHub repository with the **repository root** as its root directory. It uses the root Dockerfile and `railway.json`.
2. Clear stale custom build/start command overrides so the Dockerfile command runs. Railway's health check must be `/api/health`, matching the committed configuration.
3. Deploy. The build installs dependencies, generates Prisma and compiles all workspaces. The container starts `node apps/api/dist/index.js`, validates production web assets, and serves the API/game on `0.0.0.0:$PORT`. `WEB_ROOT` is set in the Dockerfile. Startup does not run migrations.
4. Generate a public domain and check `/`, the referenced JavaScript asset, `/api/health`, then create a new game. Inspect deployment logs for `startup_begin`, `startup_configuration` and `startup_complete`. Startup failures log `startup_failed` to stderr and exit 1.
5. PostgreSQL is optional for current browser-local gameplay. For database-backed readiness/session foundations, add PostgreSQL, reference its private `DATABASE_URL`, and explicitly apply committed migrations with `npm run db:migrate` in a controlled Railway shell/job. Do not commit credentials. Check `/api/ready` separately; it returns 503 when the database is missing or unavailable. Authentication storage also fails explicitly when unavailable. Use a single migration job for multiple replicas.

Current gameplay has browser-local saves, no login issuance and no cloud-save endpoints. Do not advertise cloud saves. Preserve a browser-save backup before rollout/rollback: the large-world game writes schema 5, which older builds cannot read.

The [startup fix report](RAILWAY-STARTUP-FIX.md) explains the failure paths, production smoke test and log locations. The original reported Railway crash could not be confirmed without the service/logs. This environment's full Docker build reaches Prisma generation but its checksum download from `binaries.prisma.sh` returns HTTP 403. TLS/checksum verification remains enabled; no successful full-image build or live rollout is claimed. Earlier Stage 1 SQL was independently applied to an isolated PostgreSQL 16 instance. This fix performs no database migration.

Run `npm run test:production` to build and test the real production entry point, including absent/invalid database settings and explicit fatal startup diagnostics. CI also attempts the full Docker build. The deployment Dockerfile uses plain RUN instructions: Railway's reported builder rejects secret mounts. Keep environment-specific proxy certificate setup out of this deployment file; normal Railway builds require no session CA.

V0.3.1 is being implemented in verified passes. The current `0.3.1-phase.1` build contains large-world support only; do not label it the completed industrial expansion. See [Phase 1](V0.3.1-PHASE1.md).
