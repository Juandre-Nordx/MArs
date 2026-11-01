# Railway startup fix

The V0.3.1 Phase 1 PR was reported to fail both build and deployment without useful logs. No Railway service link, build/deployment logs or credentials were available, so the exact production failure has **not** been confirmed.

## Code findings and fix

The previous Docker command ran `npm run db:migrate && npm run start -w @mars/api`. A migration error prevented the HTTP server from opening its port. Railway also used `/api/ready`, whose database dependency could reject an otherwise functional browser-local game. That handler returned 503 without an application diagnostic. These were real deployment failure paths; they are not proof of the specific Railway incident.

- Docker now runs the compiled Node entry point directly. Startup performs no schema writes and no longer waits for migrations. Database setup is an explicit, separate administrative action.
- Railway uses `/api/health` for HTTP availability. In production, startup first verifies built `index.html` exists, then registers static assets and opens `0.0.0.0:$PORT`. Health becomes reachable only after that completes.
- `/api/ready` retains database readiness semantics. It returns 503 for missing or unavailable database configuration, logs a safe diagnostic/error code, and logs recovery. Authentication storage stays unavailable with 503 when its database is unavailable. Neither endpoint claims cloud saves work.
- Startup logs `startup_begin` before importing application dependencies, then `startup_configuration` and `startup_complete`. Port validation, missing web assets and dependency/listen failures produce `startup_failed` on stderr and exit 1. Database URLs, tokens and arbitrary exception messages are excluded from diagnostics.
- Default static paths are resolved relative to the server module, so launching from a different directory still serves the built game. An explicit `WEB_ROOT` override is supported.
- The deployment Dockerfile uses plain RUN instructions without BuildKit secret mounts. Railway's builder rejected the earlier `type=secret` instructions before any build step ran. Removing these environment-specific mounts fixes that reported Dockerfile validation failure. TLS and checksum verification remain enabled.
- A pull-request workflow builds/tests the production entry point, builds the full deployment Dockerfile and checks the actual container command against HTTP endpoints without a database. A Docker/Prisma failure blocks that workflow instead of being silently ignored.

## Verification

```sh
npm test
npm run lint
npm run format:check
npm run test:production
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --workers=1
```

Final local results: **99 unit tests**, **16 browser tests**, all **4 production smoke scenarios**, the production workspace build, lint, formatting and diff checks passed. The added GitHub Actions workflow has not been run here.

The production smoke command builds every workspace and launches the actual compiled entry point in isolated child processes from outside the repository. It checks the built HTML/JS, health, schema-5 new-game creation, absent/invalid database settings, clean termination, missing-assets failure and invalid-port failure. Database failure/recovery and credential-redaction unit tests use mocks; no real database is changed.

Before the compatibility correction, the Docker build was attempted locally with the session CA securely mounted. Dependency installation passed; Prisma generation failed fetching the schema-engine checksum from `binaries.prisma.sh` with HTTP 403 under this cloud environment's destination policy. This does not establish that Railway has the same network restriction. The subsequently supplied Railway log confirms a separate validation failure: its builder supports cache mounts only and rejected the secret mounts. Those mounts and the unnecessary Dockerfile syntax directive have now been removed. The full image and live Railway rollout remain unverified here. Check Railway's actual build log before treating the incident as resolved. Do not disable TLS or ignore checksum failures.

## Applying on Railway

1. Deploy from the repository root using the committed Dockerfile and `railway.json`. Clear old custom Build/Start Command overrides, especially commands that run migrations before starting HTTP. The new image's command is `node apps/api/dist/index.js`.
2. Confirm the service health check is `/api/health`. A Railway UI override of `/api/ready` must be updated. Keep the platform-assigned `PORT`; do not configure a local-only listener.
3. PostgreSQL is optional for current browser-local gameplay. If database-backed readiness/session foundations are needed, configure `DATABASE_URL` using the private service reference and apply migrations explicitly with `npm run db:migrate` in a controlled Railway deployment shell/job. This PR does not execute that command against any configured database.
4. Inspect build logs for dependency installation, Prisma generation and workspace build. If a build fails, it has no runtime container to emit startup logs; select that failed build's logs. Inspect deployment logs for the three startup events after a successful build. Runtime failures should include `startup_failed` and a safe code.
5. Verify `/`, its hashed JavaScript asset, `/api/health` and `POST /api/new-game`. Check `/api/ready` separately if PostgreSQL is intended to be operational. Then verify landing and Save/Load in a browser.

No simulation, map, deposit or save schema changes are included. The game remains `0.3.1-phase.1`; the industrial expansion is still incomplete. No live service, production database or user saves were modified.
