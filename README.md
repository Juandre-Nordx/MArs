# MARS: FIRST COLONY — Stage 1

An original browser-based isometric Mars colony prototype. TypeScript, Phaser, React, Tailwind, Vite, Fastify, Prisma and PostgreSQL, organized with npm workspaces.

## Status and scope

Stage 1 source builds successfully. All 10 unit tests, the Chromium browser smoke test, lint and formatting checks pass. Full database integration and Docker verification remain **blocked** by the network policy denying Prisma engine downloads from `binaries.prisma.sh`. The initial checkout had no commits or source files. The referenced GDD and Technical Specification were not supplied, so this implementation follows the Stage 1 request only and requires reconciliation with those documents before acceptance. Stage 2 has not begun.

Implemented source: 20×20 placeholder isometric terrain; drag pan, scroll zoom and tile selection; React mission panel; API-backed new-game initialization; typed, schema-validated version 1 colony state; a deterministic 1-second fixed-step simulation clock; explicit landing cargo; resource transfer and recipe validation primitives; Fastify health/readiness routes; bearer-session verification scaffolding; Prisma users/sessions/versioned-save tables and an initial migration. Rendering, UI and pure simulation live separately.

No construction, production loop, survival consumption, research, contracts, login/token issuance or cloud-save API is operational. Data catalogs for later recipes and contracts are intentionally empty. The landing cargo is scenario input, not free production. The seed is stored for future world generation; terrain currently uses a fixed pattern. Simulation state is in memory and resets on reload. Unknown save schema versions are rejected; no migration between save versions exists yet.

## Exact local startup

Prerequisites: Node.js 22 or newer, npm 10 or newer, Docker with Compose. Run all commands from the repository root.

```sh
cp .env.example .env
# Export local example configuration to the API process. Never commit .env.
set -a
. ./.env
set +a
npm ci --no-audit --no-fund
npm run db:generate
docker compose up -d db
npm run db:migrate
npm run build
npm run dev
```

Open the Vite server on port 5173 in your local browser; it proxies `/api` to port 3001. Click **New game**. The API does not require a database for new games, but readiness and session verification do. Prisma CLI reads the exported DATABASE_URL; the API intentionally does not auto-load `.env`.

The dependency lockfile is included. Prisma generation requires HTTPS access to `binaries.prisma.sh` with checksum and TLS verification enabled. In this cloud environment that domain addition was saved to the environment configuration draft; review/save and publish it in environment settings, then retry generation and migration. npm installation required sandbox network access; it succeeded without changing proxy or TLS settings.

## Verification

```sh
npm run db:generate
npm run build
npm test
npm run lint
npm run format
npm run format:check
npx playwright install --with-deps chromium
npm run test:e2e
curl --fail http://127.0.0.1:3001/api/health
curl --fail http://127.0.0.1:3001/api/ready
```

Stop `npm run dev` before Playwright: its configuration owns its development servers. Unit tests cover clock partition determinism, tick/resource invariants, save-version rejection, inventory isolation, atomic transfers, input-funded recipes, projection round trips, new-game request validation and unauthenticated session rejection. The browser smoke test covers new game, clock progress, canvas and tile selection, and exercises pan/zoom. All 10 unit tests and the Chromium smoke test passed in this environment, including rendered canvas changes after both zoom and pan. The compiled production API also served web assets, process health and new-game responses successfully; database readiness correctly returned 503 while Prisma was unavailable. Build, lint and formatting checks also passed. For an installed system Chromium, run `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`; otherwise install the Playwright browser as above. The SQL migration was applied directly to PostgreSQL 16 successfully and the resulting tables inspected, then the test tables were removed. `prisma migrate deploy`, Prisma-backed readiness/session queries and the Docker application build remain unverified because Prisma engine downloads return HTTP 403.

## Docker

```sh
docker compose up --build
# In another terminal:
curl --fail http://127.0.0.1:3001/api/ready
```

The application serves built web assets and API from port 3001. Compose persists PostgreSQL in `mars-db`. `docker compose down` retains this volume. The example database credentials are for local development only. Docker application image build and Prisma migration execution remain unverified. Direct migration SQL execution passed. Railway setup is in [docs/RAILWAY.md](docs/RAILWAY.md).

## Architecture

- `apps/web`: React UI and Phaser lifecycle; isometric projection helpers. Phaser never mutates simulation state.
- `apps/api`: Fastify routes and session verification; Prisma schema/migrations. Session tokens are stored only as SHA-256 hashes; no insecure development login bypass exists.
- `packages/simulation`: pure typed state, schema version boundary, fixed-step clock, catalogs and inventory operations; no browser or database imports.
- `tests/unit`, `tests/e2e`: Vitest and Playwright checks.

The clock accepts elapsed time and computes whole fixed steps plus a retained remainder. Stage 1 steps change only tick count, so advancement is batched equivalently; add per-tick evaluation when later systems introduce time-dependent events. Wall-clock reads are confined to the UI adapter. Save validation is strict. Inputless recipes, negative inventories and inventory overdrafts are rejected before returning new state.

## Remaining stages (proposed, pending the design documents)

1. Finish Stage 1 validation after the Prisma domain is allowed: generate client, apply migration through Prisma, verify database readiness and session queries, and run the Docker smoke test. Reconcile the missing design documents.
2. Stage 2: reconcile authoritative specs; implement tested placement, building costs and data-driven production with explicit inputs.
3. Later: survival, power/logistics, economy/contracts, progression, real authentication and versioned persistent cloud saves, artwork/audio, balancing and deployment hardening. Exact staging awaits the GDD and Technical Specification.

Do not start Stage 2 until Stage 1 passes its required checks.
