# Stage 2: colony operations

> Historical Stage 2 baseline. [v0.2.1](V0.2.1.md) supersedes shared utility storage and version 2 saves with physical networks and schema 3.

## Requirements and boundaries

Implemented against the uploaded Stage 2 development request, extending the Stage 1 commit merged as `60ff6ee`. The previously referenced full GDD and Technical Specification remain unavailable; the rates below are explicit prototype balance choices, not claims about those missing documents. Mining, rovers, surveying, industry and trading are not implemented.

## World and landing

The original 64×32 isometric projection and 20×20 map remain. A pure seeded integer hash chooses one of three terrain surfaces, subtle variants and optional decorative rocks/ripples. Phaser draws original placeholder vector artwork. Terrain decoration does not enter the obstacle map.

Landing selects a deterministic central anchor with a one-tile seed offset, leaving the starter layout inside bounds. The camera centers on it. A 4.5-second local rendering animation draws a descending ship, changing exhaust and spreading dust. The skip button and animation callback invoke the same idempotent `deployColony` command. The pure simulation remains held during descent. Loading an active colony renders its buildings immediately; loading a descent save replays the animation. Restart destroys the old mission's visual state without retaining a deployment callback.

Starter buildings have stable unique `starter-N` IDs. Player construction has monotonic `built-N` IDs and additionally checks existing IDs when allocating. Every building has a catalog type, tile position, catalog footprint, health, enabled flag, actual worker allocation and operating status. Ten housing units each have one population slot. The manifest supplies exactly 19 structures. All footprints are tested for non-overlap and reachable perimeter access over 50 seeds.

## Fixed-step resource model

A fixed tick is 1,000 simulation milliseconds. A prototype sol is 240 ticks: 180 daylight ticks and 60 night ticks. Time speed scales elapsed time before fixed steps; every whole step evaluates production, power and consumption. Fractional elapsed time is retained. Clock partitioning produces identical state; there are no wall-clock reads or random calls in simulation logic. The UI intentionally suspends elapsed-time advancement while its browser tab is hidden. Pause retains a partial tick; explicit load/new-game starts its clock remainder at zero.

Initial resources are an explicit scenario cargo manifest, granted once by new-game creation: water 100 kg, oxygen 100 kg, food 60 kg, energy 120 kWh, metal 80 kg, wastewater 60 kg, carbon dioxide 40 kg, nutrients 80 kg, plus 100 credits. Deployment itself grants no cargo. Storage capacities derive from structures; initial combined capacities are water 200, oxygen 200, food 120, energy 240, metal 400, wastewater 200, carbon dioxide 200 and nutrients 200.

Per-tick rated processes:

| Facility         | Material inputs                                          | Material outputs              | Energy demand |
| ---------------- | -------------------------------------------------------- | ----------------------------- | ------------- |
| Oxygen generator | 0.20 kg water                                            | 0.16 kg oxygen                | 2 kWh         |
| Water recycler   | 0.10 kg wastewater                                       | 0.08 kg water                 | 1 kWh         |
| Hydroponic farm  | 0.04 kg water, 0.03 kg carbon dioxide, 0.01 kg nutrients | 0.05 kg food, 0.02 kg oxygen  | 2 kWh         |
| Solar system     | Environmental sunlight during daylight                   | 8 kWh in daylight; 0 at night | 0             |
| Command centre   | —                                                        | —                             | 0.5 kWh       |
| Housing (each)   | —                                                        | —                             | 0.05 kWh      |

Processes are simplified lossy conversions: hydrogen/unrecovered process material is vented or discarded, not returned to usable inventory. Recycling does not produce new water without wastewater; farming requires water, carbon dioxide and nutrients. Nutrients and metal are finite starter supplies. There is no replenishment mechanic or infinite closed-loop economy at this stage.

Colonists require 0.01 kg oxygen, 0.008 kg water and 0.003 kg food each tick. Actual consumption is bounded by available inventory. Consumed water returns 75% as wastewater; consumed oxygen returns carbon dioxide up to available tank space; excess waste is vented. Unmet demand is recorded and produces critical alerts. Population remains ten: mortality, medical effects, births, staffing UI and game-over behavior are outside Stage 2.

Enabled/healthy structures allocate workers in stable building-array order up to population. Oxygen/recycling need one worker each; farms need two. Understaffed structures stop. Production is processed in stable building order, granting earlier structures power priority. Buildings lacking energy, workers or recipe inputs do not produce. A full output store stalls the whole recipe before charging its inputs. Existing stored resources are never negative or over capacity. New production from earlier facilities can feed later facilities in the same tick.

Solar generation supplies demand first; enabled batteries discharge for remaining demand and charge from unused solar, within storage limits. Disabled batteries keep their stored charge isolated and cannot charge/discharge. Surplus beyond battery capacity is curtailed. No repair or demolition command can currently reduce storage capacity under existing contents. Power figures in the UI are energy per tick, not real-time watts.

Telemetry records last-tick actual produced/consumed/unmet quantities and grid generation/demand/use/battery change. Recipe rates in the inspector are explicitly labeled rated; connected inventories refer to the actual shared colony store. Storage buildings do not have separate local inventories or logistics yet. Condition defaults to 100%; no damage events have been introduced.

## Construction and interface

The top HUD displays colony name, sol, population, actual oxygen/water/food/energy stores and credits. Pause/1×/2×/4× controls are in the top bar alongside session controls. The right inspector includes type, ID, health, workers, rated power, operational status, rated recipe, connected inventories, capacity, actual colony flow totals and alerts. Selecting the roster scrolls the inspector back to its details.

Construction categories cover housing, life support, power and storage, with mining/industry visibly locked. Choosing a building previews its full footprint in green/red over the current tile and explains invalid placement. The command checks integer bounds, footprint collision, reachable building access, metal and credits. Valid construction deducts catalog costs atomically and creates one building. Failed placement changes no resources. Starship construction is prohibited. Escape or Cancel exits placement mode. Initial buildings are supplied by the mission manifest; they are not charged again.

## Save compatibility and database changes

Gameplay state schema advances from 1 to 2. Version 2 stores the seed, landing phase/anchor, inventory, buildings, population, credits, speed, ID counter and telemetry. Strict validation rejects malformed data, duplicate IDs, overlapping/out-of-bounds footprints, invalid landing anchors, unsupported versions, excessive workers and over-capacity inventory before replacing an existing colony.

`loadSave` migrates version 1 into a deployed Stage 2 colony while preserving its name, tick, seed and existing water/oxygen/metal quantities. New resource types and credits start at zero; migration does not grant another starting cargo. Legacy quantities outside Stage 2 storage limits are rejected, not silently discarded. Only the version 1 to 2 migration exists; future versions need an explicit migration.

The UI has one browser-local save slot, `mars-first-colony-save`. Storage errors are reported. No server cloud-save route, login issuance or automatic saving was added.

**No PostgreSQL schema change or SQL migration is required for Stage 2.** The existing `ColonySave.state` JSONB and integer `schemaVersion` fields accommodate the new format. Future cloud-save endpoints must validate/migrate state through this package and enforce authenticated ownership. Existing users, sessions and save tables remain unchanged. Fastify routes, static serving and Railway configuration retain the same paths/ports; health now reports Stage 2.

## Validation and remaining limits

- Production build, 30 unit tests, four Chromium end-to-end tests, ESLint and formatting checks passed.
- Unit checks cover the requested generation/count/placement/consumption/production/power/limits/speed/selection/idempotence cases, existing resource conservation helpers, legacy migration, worker shortages and disabled batteries.
- Browser checks cover actual automatic landing and skip, pause and acceleration, all facility types in the inspector, enable/disable, paid construction and collision preview, active/landing save loads, restart, alerts, and the existing camera/selection regression test.
- Layouts at 1366×768, 1280×720 and 1024×768 retain a usable canvas and have no horizontal overflow; the inspector scrolls independently.
- Full Docker/Prisma integration and live Railway deployment are not validated: no live connection is configured, and this environment's network policy still denies Prisma engine downloads. The existing Dockerfile, Compose and railway.json are unchanged. No production database or Railway service was modified.
- Placeholder geometry remains; no external/commercial artwork is used. Phaser contributes a build chunk above Vite's advisory size threshold.

The Stage 2 gameplay is exercised locally. Before deploying, review the balance choices and version migration, and run the documented Docker/Prisma checks in the deployment environment. Stage 3 surveying/rovers/mining remains unstarted; do not treat it as available.
