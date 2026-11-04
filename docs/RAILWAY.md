# Railway deployment

1. Add a Railway service from this GitHub repository with the **repository root** as its root directory. It uses the root Dockerfile and `railway.json`.
2. Clear stale custom build/start command overrides so the Dockerfile command runs. Railway's health check must be `/api/health`, matching the committed configuration.
3. Deploy. The build installs dependencies, generates Prisma and compiles all workspaces. The container starts `node apps/api/dist/index.js`, validates production web assets, and serves the API/game on `0.0.0.0:$PORT`. `WEB_ROOT` is set in the Dockerfile. Startup does not run migrations.
4. Generate a public domain and check `/`, the referenced JavaScript asset, `/api/health`, then create a new game. Inspect deployment logs for `startup_begin`, `startup_configuration` and `startup_complete`. Startup failures log `startup_failed` to stderr and exit 1.
5. PostgreSQL is optional for current browser-local gameplay. For database-backed readiness/session foundations, add PostgreSQL, reference its private `DATABASE_URL`, and explicitly apply committed migrations with `npm run db:migrate` in a controlled Railway shell/job. Do not commit credentials. Check `/api/ready` separately; it returns 503 when the database is missing or unavailable. Authentication storage also fails explicitly when unavailable. Use a single migration job for multiple replicas.

V0.4 provides administrator login and catalogue publication at `/admin`; player registration and cloud saves remain unavailable. Apply the committed migrations in a controlled job, set `ADMIN_ORIGIN` to the exact public HTTPS origin, and create the initial administrator through the private-stdin CLI. See [V0.4 operator commands and configuration](V0.4.md). No automatic seed or migration runs during HTTP startup.

Uploaded icons/sprites are stored as PostgreSQL bytea, so no ephemeral container upload directory or Railway volume is needed. Back up the complete database and retain historical versions/assets. Existing saves embed their catalogue; their uploaded artwork uses the retained public asset endpoint. Preserve browser-save backups before rollout/rollback: schema 8 cannot be read by older builds.

The JavaScript Prisma client and isolated PostgreSQL integration were verified locally. The migration CLI's native schema-engine download remains blocked by this managed environment; no live Railway migration/rollout was performed. The [startup fix report](RAILWAY-STARTUP-FIX.md) remains historical context.

Run `npm run test:production` to build and test the real production entry point, including absent/invalid database settings and explicit fatal startup diagnostics. CI also attempts the full Docker build. The deployment Dockerfile uses plain RUN instructions: Railway's reported builder rejects secret mounts. Keep environment-specific proxy certificate setup out of this deployment file; normal Railway builds require no session CA.

V0.4 edits supported definitions; it does not supply every planned industry system. See [implemented capabilities and limitations](V0.4.md).
