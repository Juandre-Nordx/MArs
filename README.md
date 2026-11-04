# MARS: FIRST COLONY — V0.4

An original browser-based isometric Mars colony prototype. Stage 2 extends the existing Stage 1 code; Phaser projection/camera controls, React/Vite, Fastify, npm workspaces and Railway configuration are preserved.

## Catalogue administration

V0.4 adds `/admin`: protected administrator sessions, resource/building/recipe editors, original isometric placeholder art, durable image uploads, validated drafts, atomic immutable publication and audit history. New colonies select a published catalogue; schema-8 browser saves embed their catalogue so future edits never silently change them. Unsupported industry remains planned. Existing colony gameplay and the drone fixes below are preserved.

See [V0.4 setup, exact configuration, capability limits and verification](docs/V0.4.md). Administration needs PostgreSQL; gameplay continues without it. Production migrations and initial administrator creation are explicit operator commands, never startup actions.

## Independent drone jobs

V0.3.3.1 keeps one drone assigned to each survey job or mine. Overlapping survey areas wait for their current owner to finish, even when they come from different stations or use different scan modes. Other charged drones skip those waiting areas and take independent compatible queues. After finishing, a drone can take another reachable job directly when its battery has enough return reserve.

Expand **Survey jobs and drones** to see each queue's assigned drone or why it is waiting. Job ownership stays reserved during travel, charging and blocked routes. Older saves with separate active surveys covering the same ground are requeued safely without resetting scan progress, deposits, batteries or stored resources. Drones can still share travel corridors and charging contacts.

See [V0.3.3.1 fix and validation](docs/V0.3.3.1.md).

## Building information and drone production

Click a building footprint or choose it from **Building roster** to open the same information popup. Switch buildings from the roster, close with **×** or **Escape**, and scroll inside the popup for long inventories and queues. The popup is modeless: pan/zoom on uncovered terrain still works. Popup controls do not issue terrain/construction commands. Information includes purpose, placeholder artwork, condition, enabled state, workers, whole-grid power metrics, footprint connections, local utility/mine storage, assigned drones and separately labelled shared cargo.

A **Survey and drone station** offers **Survey drone** (15 metal, 12 assembly ticks) and **Extraction drone** (20 metal, 18 assembly ticks). Select a product and choose **Queue survey drone** or **Queue extraction drone**. Each work tick needs **1 kWh additional electricity**, on top of the station's 0.25 kWh base load. The prototype uses documented starter-metal recipes; raw ore is not usable metal. There are no technology prerequisites or assembly workers in this release, and no cargo-drone product.

Materials leave shared stock immediately and remain in a saved reservation. Each station supports five queued orders and eight total deployed/reserved drones, including its two original drones; colony fleet/output reservations are capped at 800. Orders run FIFO. After the configured assembly ticks, a saved completed output waits for deployment on a following powered tick. A free explored footprint entry is required; power loss, disabled/destroyed equipment or blocked deployment pauses the order without losing progress. Normal simulation pause and speeds apply.

**Cancel order** refunds the full saved material reservation, including partial/completed assembly; electricity already consumed is never refunded. If shared storage cannot accept the refund, cancellation is rejected and the order/reservation remain intact. Deployment creates one unique saved drone with an empty battery; it may begin ordinary paid charging at its deployment entry during that same fixed tick. Produced drones join existing survey/mining jobs automatically. Cargo logistics, refining and factory products remain pending.

See [V0.3.3 release notes and validation](docs/V0.3.3.md).

## Large-world foundation

The first V0.3.1 implementation pass adds a 512×512 logical world, visible 16×16 terrain chunks, saved fog, deterministic regions and versioned map expansion. Use **World navigation** to visit coordinates or return to the colony. Panning does not explore terrain; construction outside explored land is blocked. Deposits are seed-defined and finite, with discovery separate from terrain exploration. Geological scans, survey/extraction drones and finite local-buffer mining are now available. Cargo logistics, refining and factories remain pending. [Phase 1 report, benchmarks and remaining work](docs/V0.3.1-PHASE1.md).

Gameplay saves now use schema 7, retaining schema 1–6 migration support. Existing colony positions, utilities, resources, residents and arrivals are preserved. The original 20×20 terrain stays unchanged.

## Central landings

New colonies land at **256,256**, in the middle of the 512×512 map, with the 20×20 explored starting area around the colony. Starter mineral deposits move nearby to **261–267,264**, preserving their seeded mineral types, richness and doubled reserves. Immigration uses the local staging perimeter. Existing saves keep their original colony, world, discoveries and convoy locations; older colonies retain their nearby deposits at 21–27,24.

## More supplies and easier discovery

New colonies start with double the resource shipment: 200 water, 200 oxygen, 120 food, 240 energy, 160 metal, 120 wastewater, 80 carbon dioxide and 160 nutrients (kg, except energy in kWh). Existing storage holds the entire shipment. Newly generated mineral deposits contain twice their former reserves. Existing saved inventory and already materialized deposits retain their saved quantities, including depleted reserves; loading or rescanning never refills them.

Scanners now default to subsurface mode, reaching every currently generated deposit depth. Shallow scans reach 100 m and subsurface scans reach 500 m. Subsurface/deep scans complete each tile twice as quickly, and all scan modes use half the energy.

## Geological scanning, mining and storage

Open **Mining** in the construction toolbar. Build a **Survey and drone station** on explored terrain and connect an electrical cable to any footprint side. Its paid construction includes one survey drone and one extraction drone with empty batteries. Extra solar generation and grid storage can help charge drones while life support continues.

In **Geological operations**, choose a station, surface/subsurface/deep mode and inclusive region corners (up to 16×16 tiles, within 64 tiles per axis of the station). You can select terrain and use **Use selected tile as scan start/end**. **Queue geological scan** schedules an aerial drone trip; travel, scanning and charging take simulation ticks. Surface detects deposits down to 100 m, the default subsurface mode down to 500 m (covering all currently generated depths), and deep mode down to 1,000 m. Subsurface/deep scanning takes half as many ticks as before, and every mode uses half the scan energy. Enable **Map terrain too** to explore those tiles independently; mineral discovery alone does not clear terrain fog. The guaranteed starter feedstocks are at tiles 261–267,264 for new central colonies (21–27,24 in older worlds); the default subsurface scan can find buried lithium and ice. Simulation pause also pauses these jobs.

Choose **Geological overlay** in Network display, then click a known deposit or choose it from **Discovered deposits**. The inspector shows the actual remaining reserve estimate, richness, depth and extraction technology. Unknown deposits never appear on this overlay or list. Repeated surveys cannot refill a deposit.

Build a **Surface mine**, **Subsurface mine**, **Ice drill** or **Deep bore mine** directly on an explored, discovered compatible deposit, then connect electricity. All four extraction technologies are available in this prototype; there is no research unlock system. A ground extraction drone from a station within 96 Manhattan tiles is assigned automatically. It travels around buildings, mines only on site, and returns to its own station to recharge using real grid energy. If a route becomes blocked, the drone waits and retries against current footprints. Mine status and the drone/job list explain disabled buildings, missing power/drones, travel, charging, blocked routes, full buffers and depletion.

**Storage overview** beside Save/Load displays all colony resource quantities/capacities and low/full warnings. Shared cargo (including metal and food) is counted once without invented building ownership; capacity contributors link to the buildings. Water, oxygen and grid energy show their actual physical stores. Each mine's raw minerals remain in a separate finite buffer. Drone batteries are shown separately after their charge has left the grid. Selection controls open the relevant building inspector.

**Cargo transport and refining are pending.** Raw ore and raw ice never become usable metal/water or teleport into colony inventory. Full mines stop until a future cargo system exists. See [Phase 2 release notes](docs/V0.3.1-PHASE2.md) for rates, capacities, migration and validation.

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
- Building inspection, footprint selection, roster, enable/disable controls and paid construction with valid/invalid footprint previews. Mining is unlocked; refining and factories remain pending.
- Explicit browser Save/Load with strict version 8 validation and version 1–7 migrations. Administrator login is available at `/admin`; player registration and cloud saves remain unavailable.

See [Stage 2 design, validation and limitations](docs/STAGE2.md) and [Railway deployment](docs/RAILWAY.md). The industrial expansion has started with large-world support; later phases remain pending.

## Exact local startup

Prerequisites: Node.js 22+, npm 10+, Docker with Compose. Run from the repository root.

```sh
cp .env.example .env
set -a
. ./.env
set +a
PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci --no-audit --no-fund
npm run db:generate
docker compose up -d db
npm run db:migrate
npm run build
npm run dev
```

Vite serves the web application on port 5173 and proxies `/api` to Fastify on port 3001. Click **New game**, watch or skip the landing, select a building and try the toolbar. A new game replaces unsaved progress after confirmation. **Save** stores one slot in this browser; **Load** validates before replacing current state. No automatic or cloud save is implied.

For gameplay development without database integration, installation, client generation, build and dev startup are sufficient. Do not export `DATABASE_URL` for that mode. The server never applies migrations. Default new games use the current publication when available; an unavailable catalogue database produces an explicit built-in fallback warning. Explicit catalogue selections fail if unresolved. See [admin setup](docs/V0.4.md) for the private initial-password command and `ADMIN_ORIGIN`.

The official JavaScript Prisma client/generator works without native query-engine downloads. The migration CLI still requires the Prisma schema engine; its download host is blocked in this managed environment. Test migrations were applied only to a disposable local PostgreSQL container, with TLS/checksum verification unchanged.

## Verification

V0.4: 169 unit/PostgreSQL integration tests and all 25 Chromium tests passed, along with production build/startup, lint, formatting and world performance checks. A clean Node 22 container install/build/startup also passed with the managed proxy CA mounted read-only. The standard deployment Docker build remains blocked by the managed CA trust boundary; see [exact results and setup limits](docs/V0.4.md). No production migration or deployment was performed.

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
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --workers=1 --timeout=90000
```

Phase 1 validation (historical): production workspace build, 99 Vitest tests, sixteen Chromium browser checks, lint and formatting passed. Historical V0.3.3.1 validation (148 unit tests and six targeted browser checks) is recorded in [the fix notes](docs/V0.3.3.1.md); [V0.3.3 validation](docs/V0.3.3.md) covers the preceding full browser run; [Phase 2 results](docs/V0.3.1-PHASE2.md) are historical. Coverage includes seeded maps, exact starter counts/accessibility, idempotent deployment/load, production/consumption accounting, power/worker starvation, capacity limits over 1,500 ticks, clock determinism/speeds, save migration, footprint selection, paid construction and the original economic/camera checks. Earlier baseline layouts were inspected at 1366×768, 1280×720 and 1024×768. The new large-world browser checks use the Playwright default viewport; pure culling tests cover 1366×768 at minimum zoom.

For database/container verification when access is available:

```sh
npm run db:generate
npm run db:migrate
curl --fail http://127.0.0.1:3001/api/ready
docker compose up --build
```

V0.4 migration SQL and Prisma adapter integration were verified against isolated PostgreSQL 16. Production migration/deployment remains an explicit operator action. See [V0.4 verification details](docs/V0.4.md). The Railway startup fix changes deployment health to `/api/health` and starts HTTP independently of database migrations. Database readiness remains available separately at `/api/ready`; see [startup fix details](docs/RAILWAY-STARTUP-FIX.md). Vite reports a large Phaser bundle warning; it does not fail the build.

## Architecture

- `packages/simulation/src/catalog.ts`: original gameplay definitions.
- `packages/simulation/src/catalogue.ts`: validated immutable snapshots, supported capabilities and runtime definitions.
- `apps/web/src/AdminApp.tsx`: protected dashboard and catalogue editors.
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
- `apps/api`: Fastify authentication, draft/public catalogue APIs, durable uploads and committed Prisma migrations. `/api/new-game` returns schema 8; `/api/health` identifies version 0.4.0.

## Docker and Railway

```sh
docker compose up --build
```

The compiled app and API share port 3001 in Docker. Compose retains PostgreSQL in `mars-db`; example credentials are local-development values only. Railway uses the Dockerfile, `$PORT`, `WEB_ROOT` and `/api/health` health check. Startup validates web assets and logs progress without running migrations. PostgreSQL is optional for browser-local gameplay; database readiness remains a separate `/api/ready` check. See [deployment steps](docs/RAILWAY.md). No live service was deployed or modified during this work.
