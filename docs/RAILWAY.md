# Railway deployment (not yet exercised)

1. Create a Railway project and add PostgreSQL.
2. Add a service from this GitHub repository, with the repository root as its root directory. Railway uses the root Dockerfile and railway.json.
3. Set the application service `DATABASE_URL` to a reference to the PostgreSQL service's DATABASE_URL. Do not paste database credentials into source control. Use Railway's private network connection string.
4. Deploy. The container generates Prisma during its build, builds the three workspaces, applies committed migrations at startup, then serves the API and compiled web assets on `0.0.0.0:$PORT`. WEB_ROOT is set in the Dockerfile. A migration failure stops startup.
5. Generate a public domain for the app. Check `/api/health` (process) and `/api/ready` (database), then create a new game and select a tile in the UI.

This Stage 2 app has browser-local saves but no login issuance or persistent cloud-save endpoints. The database tables are foundations only. Do not advertise cloud saves. New-game state exists in memory with an explicit browser Save/Load slot. Before production, add real authentication, rate limits, save ownership checks, backup/restore procedures and migration rollout coordination. For multiple replicas, move migration deployment to a single pre-deploy job.

The lockfile is included and Docker uses npm ci. Local production build, 97 unit tests and sixteen Chromium browser checks pass. Prisma engine downloads require binaries.prisma.sh; this destination is currently denied in the cloud environment. Prisma generation/migration and the full Docker application build remain unverified. Migration SQL was independently applied successfully to PostgreSQL 16. No Railway deployment has been performed.

The large-world phase preserves the existing Dockerfile, Compose and Railway settings. No database migration is needed for version 5 JSON gameplay state; see [V0.3.1-PHASE1.md](V0.3.1-PHASE1.md). A live deployment was reported by the user but no deployment credentials or production database connection were available to inspect or modify it here.

V0.3.1 is being implemented in verified passes. The current `0.3.1-phase.1` build contains large-world support only and must not be released as the completed industrial expansion. Existing browser saves migrate forward to schema 5; older builds cannot read schema 5, so preserve a browser-save backup before a rollout or rollback.
