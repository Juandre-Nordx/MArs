# 3D colony migration

## Repository audit

| Area                   | Current implementation                                                                                                                                                                                                  | 3D integration                                                                                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application            | React 19, TypeScript, Vite and a Phaser 3 map in `apps/web/src/World.tsx`                                                                                                                                               | The 3D canvas is a lazy-loaded sibling of the Phaser map. Both use the existing React shell and command callbacks.                                                                                                                                              |
| Simulation             | `packages/simulation/src/colony.ts` owns deployment, the 1-second fixed tick, placement and construction. The React shell advances the clock and publishes state.                                                       | The 3D scene reads colony state. It sends tile and resident selections, infrastructure route drafts and touchdown through the same callbacks. The shell checks grade before it calls the existing construction command.                                         |
| Coordinates            | A 512×512 logical grid with 16×16 chunks. Terrain, exploration and deposits use `terrain.ts` and `world.ts` in the simulation.                                                                                          | Logical X/Y become scene X/Z at one world unit per tile. Height is calculated from the saved seed and landing zone, with gentler terrain around starter plots. Exploration is shown with muted ground and discovered markers come from the existing world data. |
| Buildings and networks | Stable building IDs and catalogue-pinned rectangular footprints. `placement`, `construct`, `routePreview`, `buildInfrastructure` and `connectionTiles` own placement, costs and connectivity.                           | Procedural model scale, foundation, status, picking and connections use those definitions and saved coordinates. Roads and utility geometry use actual live cardinal edges and compatible foundation contacts.                                                  |
| Industry               | Existing production queues, local reserves, finite extraction, survey and extraction drones, residents and an immigration buggy. Cargo hauling, refining, research and construction fleets are future gameplay systems. | The scene represents the existing units and animates operating drill models. Game movements, inventories, costs and job ownership stay in simulation state.                                                                                                     |
| Persistence            | `loadSave` migrates schema 1–7 into schema 8. Saves live in browser storage and embed an immutable catalogue snapshot. The Prisma schema also defines catalogue, asset, user/session and colony-save tables.            | Both views read the same browser save and schema. Scene meshes, camera, visual grade and quality settings live in the browser view.                                                                                                                             |
| API and art            | Fastify serves new games, versioned catalogues, PNG/WebP assets and the production web build. Admin artwork can live on the API volume or in PostgreSQL.                                                                | 3D world objects use procedural geometry. The 2D view, icons and admin retain their existing asset paths. A typed web manifest in `Buildings.tsx` accepts local glTF/GLB paths, scale and yaw for later authored models.                                        |
| Railway                | Root Dockerfile serves the API and built game. The split web service builds Vite into Caddy, which proxies `/api/*`.                                                                                                    | Vite includes the lazy 3D chunk in the same static output. This stage requires no database migration, volume or environment setting.                                                                                                                            |

## Play the first slice

1. Start or load a colony using the usual commands.
2. Select **3D preview** from **Map view**. **Isometric** is the initial view and remains available when WebGL 2 is unavailable.
3. Drag with the left mouse button or use **WASD** over the map to pan. Right drag rotates and changes tilt. **Q/E** rotates horizontally. Scroll to zoom and use **Return to colony** or the roster to focus the camera.
4. Choose a building from the current build menu. Move across the ground for a transparent green or red model and footprint. Click a valid plot to construct it. Use middle drag or **WASD** to move the camera during placement. Right click or **Esc** cancels the tool.
5. Use the existing Infrastructure tools to drag and confirm a route. Network display and geological markers use the same saved state in both views.

**Balanced** uses up to 49 terrain chunks, instanced surface rocks, a bounded shadow map and a device pixel ratio capped at 1.5. **Low** uses up to 25 chunks, pixel ratio 1 and no dynamic shadows or decorative rock instances. Both use Three.js frustum culling and 1-, 2- or 4-tile terrain mesh samples as distance increases. The map size and exploration state are independent of the render distance.

## Follow-on stages

- Extend the building catalogue with authored, locally served GLBs after agreeing model units and orientation. The procedural models serve as the fallback for missing assets.
- Design authoritative footprint rotation across placement, access, ports and pathfinding before adding it to construction. The current rectangular footprint is tied to the catalogue; model yaw alone cannot rotate it. Preserve existing orientations by default in any future save change.
- Expand machinery, conveyor and dust animations as existing simulation signals become available. Add separate cargo or construction units when the simulation owns them.
- Profile on representative hardware and extended colonies before making 3D the default. The isometric fallback can be evaluated separately after the default changes.

## Changed files

| Files                                                           | Purpose                                                                                        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/web/package.json`, `package.json`, `package-lock.json`    | Pin compatible stable Three.js, Fiber and Drei versions and their shared Three.js types.       |
| `apps/web/src/main.tsx`, `World.tsx`, `style.css`               | Renderer selection, quality, WebGL fallback, shared map props and placement wiring.            |
| `apps/web/src/world3d/World3D.tsx`, `Terrain.tsx`, `terrain.ts` | 3D canvas, controls, terrain, picking, snapping and grade checks.                              |
| `apps/web/src/world3d/Buildings.tsx`, `Units.tsx`               | Building geometry, model manifest, foundations, status, previews, motion and resident picking. |
| `apps/web/src/world3d/Infrastructure.tsx`, `infrastructure.ts`  | Batched mesh rendering and live network edge derivation.                                       |
| `tests/unit/world3d.test.ts`, `tests/e2e/world3d.spec.ts`       | Terrain, coordinates, grade, network edges, renderer and save parity checks.                   |
| `README.md`, `docs/3D-MIGRATION.md`                             | Preview controls, audit and remaining migration work.                                          |

## Verification

- The pre-change baseline passed 184 unit and PostgreSQL integration tests. The branch passed 189 with the five terrain and network tests.
- Eight Chromium checks passed against the built Fastify API behind Caddy. They covered the original landing, construction and world navigation paths, plus 3D model selection, camera movement, placement, route construction, save parity and lost-context recovery.
- Production build and startup smoke checks passed. A clean `npm ci` and web build passed in the Node 22 base image. The direct Docker build stopped during dependency installation in this cloud environment. No live Railway deployment was used.

At 1011 × 565, headless Chromium with SwiftShader reported the following short samples at a paused colony. Geometry count is a renderer resource count. Frame callbacks are a software-rendering diagnostic.

| View                | Resident chunks | Resident geometries | Draw calls | Triangles | Frame callbacks per second |
| ------------------- | --------------: | ------------------: | ---------: | --------: | -------------------------: |
| Balanced, colony    |              49 |                 228 |        228 |    27,746 |                          6 |
| Low, colony         |              25 |                 220 |        220 |    26,366 |                          9 |
| Low, far map corner |               9 |                  10 |         10 |     3,522 |                         26 |

Desktop GPU profiling and the 60 FPS target remain open before a default change.
