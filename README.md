# MARS: FIRST COLONY — V0.3.1 Phase 1

An original browser-based isometric Mars colony prototype. Stage 2 extends the existing Stage 1 code; Phaser projection/camera controls, React/Vite, Fastify, npm workspaces and Railway configuration are preserved.

## Large-world foundation

The first V0.3.1 implementation pass adds a 512×512 logical world, visible 16×16 terrain chunks, saved fog, deterministic regions and versioned map expansion. Use **World navigation** to visit coordinates or return to the colony. Panning does not explore terrain; construction outside explored land is blocked. Deposits are seed-defined and finite, with discovery separate from terrain exploration. Scanning, drones, mining and industry remain unavailable pending their required phases. [Phase 1 report, benchmarks and remaining work](docs/V0.3.1-PHASE1.md).

Gameplay saves now use schema 5, retaining schema 1–4 migration support. Existing colony positions, utilities, resources, residents and arrivals are preserved. The original 20×20 terrain stays unchanged.

## Automatic utility connections

Electrical cables now connect directly beside any cardinal side of a compatible building's full footprint, just like water and oxygen pipes. Companies, homes, solar arrays and batteries share power through these contacts. Multiple contacts on one building join its electrical bus without duplicating generation or stored energy. Diagonals and gaps do not connect. Roads also attach to any footprint edge; the inspector reports actual contacts and all adjacent road components. Existing saves migrate safely to network rules version 4. [v0.2.2.3 details](docs/V0.2.2.3.md).

## Colonist conversations and water hookups

Click a suited colonist (or choose **Talk to Colonist N** in the resident roster) to hear what they appreciate, what worries them and what the colony needs. Original dialogue reflects real local utility connections, housing, food, power and reserve quantities; no invented happiness meter changes the economy.

Water pipes now connect automatically along any cardinal side of a building footprint. Multi-sided branches share one manifold without duplicating water. Later updates extend automatic connections to oxygen and electricity. The original water update introduced network rules version 2 without moving reserves or creating pipes. [v0.2.2.1 report](docs/V0.2.2.1.md).

## Walking colonists and newcomers

The ten starter colonists now visibly walk between buildings and have saved identities and homes. Each person consumes water, oxygen and food once per tick. Build an additional home, connect its utilities, and maintain safety reserves: a buggy will bring one newcomer, rechecking eligibility before they move in. Population and resource use increase only after drop-off. Pause simulation or arrivals separately, and inspect readiness in the Settlement residents panel.

Save schema 4 preserves people, routes and in-flight buggies; older saves migrate without changing population or reserves. [v0.2.2 details and how to attract newcomers](docs/V0.2.2.md).

## Preserved infrastructure

Water/oxygen pipes, electrical cables and roads now occupy separate tile layers. Compatible buildings use automatic perimeter contacts and independent network components; physical tanks/batteries keep reserves when a network splits. The starter colony includes connected utility routes and roads. Drag routes, preview total costs, confirm or cancel, demolish with configured refunds, inspect network metrics and toggle network overlays. Original cached transparent sprites replace the earlier flat blocks; the UI clearly labels them as temporary procedural art.

The v0.2.1 foundation persists infrastructure, disabled/damaged segments, physical stores and power priorities. Version 2 colonies retain buildings/resources and receive a one-time compatibility network. See [v0.2.1 implementation and migration details](docs/V0.2.1.md).

## Preserved colony gameplay

- Seeded dust, sand and basalt terrain with procedural rocks/boulders/ripples. Decoration never blocks placement.
- Automatic Starship descent, exhaust/dust, camera centering and a skip button. The simulation waits for touchdown; deployment is idempotent.
- One Starship command centre, exactly ten houses and eight support facilities: oxygen generator/tank, water recycler/tank, hydroponic farm, solar array, battery and warehouse. Nineteen total starter buildings, with unique IDs and collision-free, accessible footprints.
- Ten colonists, input-funded oxygen/water/food production, population consumption, day/night solar power, finite battery charge/discharge, storage limits, operational statuses and reserve alerts.
- Pause, 1×, 2× and 4× fixed-step simulation. HUD values come from colony state and the last completed tick.
- Building inspection, footprint selection, roster, enable/disable controls and paid construction with valid/invalid footprint previews. Mining and industry remain locked.
- Explicit browser Save/Load with strict version 5 validation and version 1/2/3/4 migrations. Cloud saves and login issuance are still unavailable.

See [Stage 2 design, validation and limitations](docs/STAGE2.md) and [Railway deployment](docs/RAILWAY.md). The industrial expansion has started with large-world support; later phases remain pending.

## Exact local startup

Prerequisites: Node.js 22+, npm 10+, Docker with Compose. Run from the repository root.

```sh
cp .env.example .env
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

Vite serves the web application on port 5173 and proxies `/api` to Fastify on port 3001. Click **New game**, watch or skip the landing, select a building and try the toolbar. A new game replaces unsaved progress after confirmation. **Save** stores one slot in this browser; **Load** validates before replacing current state. No automatic or cloud save is implied.

For gameplay development without database integration, `npm ci`, `npm run build`, `npm run dev` is sufficient. New-game creation, health and local browser saves do not access PostgreSQL. Prisma-backed readiness and session verification require a generated client and PostgreSQL. Prisma CLI needs `DATABASE_URL` exported as above; the server does not auto-load `.env`.

In this managed environment, dependencies installed successfully using the configured proxy with sandbox network access. Prisma engine downloads from `binaries.prisma.sh` still return HTTP 403; checksum/TLS verification remains enabled. The earlier domain addition is saved in the environment draft but is not applied to this runtime. Review/save and publish the configuration in environment settings before retrying database setup. No live Railway credentials or database URL were provided here.

## Verification

```sh
npm run build
npm test
npm run lint
npm run format:check
npm run benchmark:world
npm run test:production
npx playwright install --with-deps chromium
npm run test:e2e
```

Stop an existing development server before Playwright; its configuration owns the servers. With system Chromium available, use:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Current validation: production workspace build, 99 Vitest tests, sixteen Chromium browser checks, lint and formatting passed. Coverage includes seeded maps, exact starter counts/accessibility, idempotent deployment/load, production/consumption accounting, power/worker starvation, capacity limits over 1,500 ticks, clock determinism/speeds, save migration, footprint selection, paid construction and the original economic/camera checks. Earlier baseline layouts were inspected at 1366×768, 1280×720 and 1024×768. The new large-world browser checks use the Playwright default viewport; pure culling tests cover 1366×768 at minimum zoom.

For database/container verification when access is available:

```sh
npm run db:generate
npm run db:migrate
curl --fail http://127.0.0.1:3001/api/ready
docker compose up --build
```

Stage 1 migration SQL was independently applied successfully to PostgreSQL 16. Prisma-managed migration/client integration and the full Docker application image remain unverified here due to the engine download restriction. The Railway startup fix changes deployment health to `/api/health` and starts HTTP independently of database migrations. Database readiness remains available separately at `/api/ready`; see [startup fix details](docs/RAILWAY-STARTUP-FIX.md). Vite reports a large Phaser bundle warning; it does not fail the build.

## Architecture

- `packages/simulation/src/catalog.ts`: shared building/resource definitions, costs, recipes, storage and rates.
- `packages/simulation/src/feedback.ts`: read-only, state-grounded citizen dialogue and city advice.
- `packages/simulation/src/people.ts`: saved residents, deterministic navigation and gated buggy arrivals.
- `packages/simulation/src/networks.ts`: reusable channel graphs, ports, physical storage and infrastructure rules.
- `packages/simulation/src/terrain.ts`: deterministic seed hashing, regions and chunk generation.
- `packages/simulation/src/world.ts`: sparse explored chunks, finite geological deposits and world validation.
- `apps/web/src/viewport.ts`, `WorldNavigator.tsx`: viewport culling and coordinate navigation.
- `packages/simulation/src/colony.ts`: validated state, deployment, footprints/access, commands, simulation clock and save migration.
- `packages/simulation/src/inventory.ts`: preserved Stage 1 pure inventory/recipe helpers.
- `apps/web/src/actors.ts` and `ResidentsPanel.tsx`: cached people/buggy rendering and settlement controls.
- `apps/web/src/art.ts`: cached transparent temporary building/connection sprites.
- `apps/web/src/NetworkInspector.tsx`: actual network observations and segment controls.
- `apps/web/src/World.tsx`: Phaser terrain, placeholder buildings, landing animation and camera; it never edits colony state.
- `apps/web/src/main.tsx`: React HUD, construction/inspection and clock adapter; every gameplay mutation calls simulation functions.
- `apps/api`: compatible Fastify endpoints and the original Prisma schema/migration. `/api/new-game` now returns schema version 5 and `/api/health` identifies prerelease 0.3.1-phase.1.

## Docker and Railway

```sh
docker compose up --build
```

The compiled app and API share port 3001 in Docker. Compose retains PostgreSQL in `mars-db`; example credentials are local-development values only. Railway uses the Dockerfile, `$PORT`, `WEB_ROOT` and `/api/health` health check. Startup validates web assets and logs progress without running migrations. PostgreSQL is optional for browser-local gameplay; database readiness remains a separate `/api/ready` check. See [deployment steps](docs/RAILWAY.md). No live service was deployed or modified during this work.
