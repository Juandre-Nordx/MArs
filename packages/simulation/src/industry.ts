import { z } from 'zod';
import { WORLD_SIZE, type BuildingType } from './catalog.js';
import type { Building, ColonyState } from './colony.js';
import type { Tile } from './terrain.js';
import { door, walkingPath } from './people.js';
import { isUsable, cells, tileKey, connectionTiles } from './networks.js';
import {
  chunkKey,
  chunkOf,
  generateDeposits,
  revealArea,
  type Deposit,
  type WorldState,
} from './world.js';

const tileSchema = z
  .object({
    x: z
      .number()
      .int()
      .min(0)
      .max(WORLD_SIZE - 1),
    y: z
      .number()
      .int()
      .min(0)
      .max(WORLD_SIZE - 1),
  })
  .strict();
export const scanModeSchema = z.enum(['surface', 'subsurface', 'deep']);
export type ScanMode = z.infer<typeof scanModeSchema>;
const scanSettingsSchema = z
  .object({
    maxDepth: z.number().nonnegative(),
    ticks: z.number().int().positive(),
    energy: z.number().positive(),
  })
  .strict();
export const scanDefinitions = z
  .object({
    surface: scanSettingsSchema,
    subsurface: scanSettingsSchema,
    deep: scanSettingsSchema,
  })
  .strict()
  .parse({
    surface: { maxDepth: 100, ticks: 1, energy: 0.25 },
    subsurface: { maxDepth: 500, ticks: 1, energy: 0.5 },
    deep: { maxDepth: 1000, ticks: 2, energy: 1 },
  });
export const extractionDefinitions = z
  .object({
    'surface-mine': z.object({
      technology: z.literal('surface'),
      maxDepth: z.number(),
      rate: z.number().positive(),
      capacity: z.number().positive(),
    }),
    'underground-mine': z.object({
      technology: z.literal('underground'),
      maxDepth: z.number(),
      rate: z.number().positive(),
      capacity: z.number().positive(),
    }),
    'ice-drill': z.object({
      technology: z.literal('ice-drill'),
      maxDepth: z.number(),
      rate: z.number().positive(),
      capacity: z.number().positive(),
    }),
    'deep-mine': z.object({
      technology: z.literal('deep'),
      maxDepth: z.number(),
      rate: z.number().positive(),
      capacity: z.number().positive(),
    }),
  })
  .strict()
  .parse({
    'surface-mine': {
      technology: 'surface',
      maxDepth: 0,
      rate: 2,
      capacity: 40,
    },
    'underground-mine': {
      technology: 'underground',
      maxDepth: 1000,
      rate: 1,
      capacity: 30,
    },
    'ice-drill': {
      technology: 'ice-drill',
      maxDepth: 1000,
      rate: 1,
      capacity: 30,
    },
    'deep-mine': {
      technology: 'deep',
      maxDepth: 1000,
      rate: 0.5,
      capacity: 20,
    },
  });
export type MineType = keyof typeof extractionDefinitions;
export function isMine(type: BuildingType): type is MineType {
  return Object.hasOwn(extractionDefinitions, type);
}
const droneSettingsSchema = z
  .object({
    capacity: z.number().finite().positive(),
    moveEnergy: z.number().finite().positive(),
    chargeRate: z.number().finite().positive(),
  })
  .strict();
export const droneDefinitions = z
  .object({ survey: droneSettingsSchema, extractor: droneSettingsSchema })
  .strict()
  .parse({
    survey: { capacity: 128, moveEnergy: 0.25, chargeRate: 4 },
    extractor: { capacity: 64, moveEnergy: 0.25, chargeRate: 2 },
  });
export const droneFleetLimits = z
  .object({
    station: z.number().int().positive(),
    global: z.number().int().positive(),
  })
  .parse({ station: 8, global: 800 });
const scanSchema = z
  .object({
    id: z.string().min(1),
    stationId: z.string().min(1),
    mode: scanModeSchema,
    from: tileSchema,
    to: tileSchema,
    exploreTerrain: z.boolean(),
    cursor: z.number().int().nonnegative(),
    progress: z.number().int().nonnegative(),
    status: z.enum(['queued', 'active', 'complete']),
  })
  .strict();
const droneSchema = z
  .object({
    id: z.string().min(1),
    stationId: z.string().min(1),
    kind: z.enum(['survey', 'extractor']),
    position: tileSchema,
    battery: z.number().finite().nonnegative(),
    job: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('scan'), id: z.string() }).strict(),
        z.object({ type: z.literal('mine'), id: z.string() }).strict(),
      ])
      .nullable(),
    activity: z.enum([
      'idle',
      'travelling',
      'working',
      'returning',
      'charging',
      'blocked',
    ]),
  })
  .strict();
export const industrySchema = z
  .object({
    nextScanId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    scans: z.array(scanSchema).max(64),
    drones: z.array(droneSchema).max(800),
    mines: z
      .array(
        z
          .object({
            buildingId: z.string().min(1),
            depositId: z.string().min(1),
            quantity: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      .max(400),
  })
  .strict();
export type Industry = z.infer<typeof industrySchema>;
export type Drone = Industry['drones'][number];
export const emptyIndustry = (): Industry => ({
  nextScanId: 1,
  scans: [],
  drones: [],
  mines: [],
});
const distance = (a: Tile, b: Tile) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const same = (a: Tile, b: Tile) => a.x === b.x && a.y === b.y;
const rounded = (n: number) => Math.round(n * 1e6) / 1e6;
export function discoveredDeposits(world: WorldState): Deposit[] {
  return Object.values(world.chunks).flatMap((c) =>
    c.deposits.filter((d) => d.discovered),
  );
}
export function canDetect(deposit: Deposit, mode: ScanMode): boolean {
  return deposit.depth <= scanDefinitions[mode].maxDepth;
}
// Copy only a touched chunk. Existing reserves are authoritative, including depleted ones.
export function scanTile(
  world: WorldState,
  seed: number,
  tile: Tile,
  mode: ScanMode,
): WorldState {
  tileSchema.parse(tile);
  scanModeSchema.parse(mode);
  const c = chunkOf(tile),
    key = chunkKey(c.x, c.y);
  const previous = world.chunks[key];
  const deposits = (
    previous?.deposits ??
    generateDeposits(seed, c.x, c.y, world.generatorVersion)
  ).map((d) =>
    same(d, tile) && canDetect(d, mode) ? { ...d, discovered: true } : d,
  );
  return {
    ...world,
    chunks: {
      ...world.chunks,
      [key]: { x: c.x, y: c.y, explored: previous?.explored ?? [], deposits },
    },
  };
}
export function requestScan(
  state: ColonyState,
  stationId: string,
  mode: ScanMode,
  from: Tile,
  to: Tile,
  exploreTerrain = false,
): ColonyState {
  scanModeSchema.parse(mode);
  tileSchema.parse(from);
  tileSchema.parse(to);
  z.boolean().parse(exploreTerrain);
  const station = state.buildings.find(
    (b) => b.id === stationId && b.type === 'survey-station',
  );
  if (state.phase !== 'active' || !station || !isUsable(station))
    throw new Error('An enabled survey station is required');
  if (Math.abs(from.x - to.x) >= 16 || Math.abs(from.y - to.y) >= 16)
    throw new Error('Select at most a 16 × 16 region');
  if (
    [from, to].some(
      (t) => Math.abs(t.x - station.x) > 64 || Math.abs(t.y - station.y) > 64,
    )
  )
    throw new Error('Region outside station range (64 tiles per axis)');
  if (state.industry.nextScanId === Number.MAX_SAFE_INTEGER)
    throw new Error('Survey identity limit reached');
  if (state.industry.scans.filter((s) => s.status !== 'complete').length >= 16)
    throw new Error('Survey queue full');
  const industry = structuredClone(state.industry);
  industry.scans = industry.scans
    .filter((s) => s.status !== 'complete')
    .concat(industry.scans.filter((s) => s.status === 'complete').slice(-31));
  industry.scans.push({
    id: `scan-${industry.nextScanId++}`,
    stationId,
    mode,
    from: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) },
    to: { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y) },
    exploreTerrain,
    cursor: 0,
    progress: 0,
    status: 'queued',
  });
  return { ...state, industry };
}
export function minePlacement(
  state: ColonyState,
  type: BuildingType,
  tile: Tile,
): string | null {
  if (!isMine(type)) return null;
  const deposit = discoveredDeposits(state.world).find(
    (d) =>
      same(d, tile) &&
      d.technology === extractionDefinitions[type].technology &&
      d.depth <= extractionDefinitions[type].maxDepth,
  );
  if (!deposit) return 'Requires a discovered compatible deposit at this tile';
  if (deposit.remainingQuantity <= 0) return 'Deposit depleted';
  if (state.industry.mines.some((m) => m.depositId === deposit.id))
    return 'Deposit already has a mine';
  return null;
}
export function registerIndustryBuilding(
  state: ColonyState,
  id: string,
): ColonyState {
  const b = state.buildings.find((b) => b.id === id)!;
  if (b.type !== 'survey-station' && !isMine(b.type)) return state;
  const industry = structuredClone(state.industry);
  if (b.type === 'survey-station') {
    const entry = door(state, b);
    if (!entry) throw new Error('Station needs an accessible drone entry');
    // Included in the paid station construction; start empty, never mint electrical energy.
    for (const kind of ['survey', 'extractor'] as const)
      industry.drones.push({
        id: `${id}-${kind}`,
        stationId: id,
        kind,
        position: { ...entry },
        battery: 0,
        job: null,
        activity: 'charging',
      });
  } else {
    const d = discoveredDeposits(state.world).find(
      (d) =>
        same(d, b) &&
        isMine(b.type) &&
        d.technology === extractionDefinitions[b.type].technology,
    )!;
    industry.mines.push({ buildingId: id, depositId: d.id, quantity: 0 });
  }
  return { ...state, industry };
}
function scanTarget(scan: Industry['scans'][number]): Tile {
  const width = scan.to.x - scan.from.x + 1,
    row = Math.floor(scan.cursor / width),
    column = scan.cursor % width;
  return {
    x: scan.from.x + (row % 2 ? width - 1 - column : column),
    y: scan.from.y + row,
  };
}
function scanArea(scan: Industry['scans'][number]) {
  return (scan.to.x - scan.from.x + 1) * (scan.to.y - scan.from.y + 1);
}
function flightStep(from: Tile, to: Tile): Tile | null {
  return same(from, to)
    ? null
    : {
        x: from.x + Math.sign(to.x - from.x),
        y: from.y + (from.x === to.x ? Math.sign(to.y - from.y) : 0),
      };
}
// Called once per fixed tick, before grid energy is settled into physical batteries.
export function advanceIndustry(
  state: ColonyState,
  consumePower: (buildingId: string, requested: number) => number,
): void {
  if (!state.industry.drones.length && !state.industry.mines.length) return;
  state.industry = structuredClone(state.industry);
  const industry = state.industry;
  const deposits = new Map(
    Object.values(state.world.chunks).flatMap((c) =>
      c.deposits.map((d) => [d.id, d] as const),
    ),
  );
  const buildingById = new Map(state.buildings.map((b) => [b.id, b]));
  const powered = (b: Building | undefined): b is Building =>
    !!b && b.status === 'running';
  for (const mine of industry.mines) {
    const b = buildingById.get(mine.buildingId)!;
    if (!powered(b) || !isMine(b.type)) continue;
    b.status =
      deposits.get(mine.depositId)!.remainingQuantity <= 0
        ? 'depleted'
        : mine.quantity >= extractionDefinitions[b.type].capacity
          ? 'storage-full'
          : 'no-drone';
  }
  const booked = new Set(
    industry.drones.flatMap((d) =>
      d.job ? [`${d.job.type}:${d.job.id}`] : [],
    ),
  );
  for (const drone of industry.drones) {
    const station = buildingById.get(drone.stationId)!;
    const home = door(state, station);
    if (!home) {
      drone.activity = 'blocked';
      continue;
    }
    const definition = droneDefinitions[drone.kind];
    const atHome =
      same(drone.position, home) ||
      (drone.activity === 'charging' &&
        connectionTiles(station, 'road').some((t) => same(t, drone.position)));
    if (
      atHome &&
      drone.battery === definition.capacity &&
      ['charging', 'returning'].includes(drone.activity)
    )
      drone.activity = 'idle';
    if (
      atHome &&
      drone.battery < definition.capacity &&
      (drone.activity === 'charging' ||
        drone.activity === 'returning' ||
        !drone.job)
    ) {
      drone.activity = 'charging';
      if (powered(station))
        drone.battery = rounded(
          drone.battery +
            consumePower(
              station.id,
              Math.min(
                definition.chargeRate,
                definition.capacity - drone.battery,
              ),
            ),
        );
      if (drone.battery < definition.capacity) continue;
      drone.activity = 'idle';
    }
    if (!drone.job && powered(station) && drone.activity !== 'returning') {
      if (drone.kind === 'survey') {
        const scan = industry.scans.find(
          (s) =>
            s.stationId === station.id &&
            s.status !== 'complete' &&
            !booked.has(`scan:${s.id}`),
        );
        if (scan) {
          drone.job = { type: 'scan', id: scan.id };
          scan.status = 'active';
        }
      } else {
        const mine = industry.mines.find((m) => {
          const b = buildingById.get(m.buildingId)!;
          return (
            isMine(b.type) &&
            b.status === 'no-drone' &&
            !booked.has(`mine:${b.id}`) &&
            distance(station, b) <= 96
          );
        });
        if (mine) drone.job = { type: 'mine', id: mine.buildingId };
      }
      if (drone.job) booked.add(`${drone.job.type}:${drone.job.id}`);
    }
    let target: Tile | null = null,
      scan: Industry['scans'][number] | undefined,
      mine: Industry['mines'][number] | undefined;
    let mineBuilding: Building | undefined;
    if (drone.job?.type === 'scan') {
      scan = industry.scans.find((s) => s.id === drone.job!.id)!;
      if (scan.status === 'complete') {
        drone.job = null;
        drone.activity = 'returning';
      } else if (powered(station)) target = scanTarget(scan);
    } else if (drone.job?.type === 'mine') {
      mine = industry.mines.find((m) => m.buildingId === drone.job!.id)!;
      mineBuilding = buildingById.get(mine.buildingId)!;
      if (['no-drone', 'running'].includes(mineBuilding.status))
        target = door(state, mineBuilding);
      else {
        drone.job = null;
        drone.activity = 'returning';
      }
    }
    // Compute paths anew against current footprints; no stale route can drive through construction.
    const pathTo = (to: Tile) =>
      drone.kind === 'survey'
        ? same(drone.position, to)
          ? []
          : [flightStep(drone.position, to)!]
        : walkingPath(state, drone.position, to);
    const homePath =
      drone.kind === 'survey' ? null : walkingPath(state, drone.position, home);
    const returnDistance =
      drone.kind === 'survey'
        ? distance(drone.position, home)
        : homePath?.length;
    if (returnDistance === undefined) {
      drone.activity = 'blocked';
      if (mineBuilding) mineBuilding.status = 'route-blocked';
      continue;
    }
    if (drone.battery < returnDistance * definition.moveEnergy + 3)
      drone.activity = 'returning';
    if (
      !drone.job ||
      drone.activity === 'returning' ||
      drone.activity === 'charging'
    ) {
      if (!atHome) target = home;
      else if (drone.battery < definition.capacity) {
        drone.activity = 'charging';
        continue;
      } else {
        drone.activity = 'idle';
        continue;
      }
    }
    if (!target) {
      drone.activity = 'idle';
      continue;
    }
    const path = pathTo(target);
    if (!path) {
      drone.activity = 'blocked';
      if (mineBuilding) mineBuilding.status = 'route-blocked';
      continue;
    }
    // Do not start an outbound trip that cannot leave enough energy to get home.
    const tripDistance =
      drone.kind === 'survey' ? distance(drone.position, target) : path.length;
    if (
      drone.activity !== 'returning' &&
      drone.battery <
        (tripDistance + distance(target, home)) * definition.moveEnergy + 3
    ) {
      drone.activity = 'returning';
      continue;
    }
    if (path.length) {
      if (drone.battery < definition.moveEnergy) {
        drone.activity = 'blocked';
        if (mineBuilding) mineBuilding.status = 'route-blocked';
        continue;
      }
      drone.position = path[0]!;
      drone.battery = rounded(drone.battery - definition.moveEnergy);
      if (drone.activity !== 'returning') drone.activity = 'travelling';
      if (mineBuilding && mineBuilding.status === 'no-drone')
        mineBuilding.status = 'drone-travelling';
      continue;
    }
    if (drone.activity === 'returning') {
      drone.activity = 'charging';
      continue;
    }
    drone.activity = 'working';
    if (scan && powered(station)) {
      const settings = scanDefinitions[scan.mode];
      drone.battery = rounded(drone.battery - settings.energy / settings.ticks);
      if (++scan.progress >= settings.ticks) {
        state.world = scanTile(state.world, state.seed, target, scan.mode);
        if (scan.exploreTerrain)
          state.world = revealArea(state.world, state.seed, target, target);
        scan.progress = 0;
        scan.cursor++;
        if (scan.cursor === scanArea(scan)) {
          scan.status = 'complete';
          drone.job = null;
          drone.activity = 'returning';
        }
      }
    }
    if (mine && mineBuilding && isMine(mineBuilding.type)) {
      const d = deposits.get(mine.depositId)!;
      const settings = extractionDefinitions[mineBuilding.type];
      const amount = Math.min(
        settings.rate * d.richness,
        d.remainingQuantity,
        settings.capacity - mine.quantity,
      );
      if (amount > 0) {
        const c = chunkOf(d),
          key = chunkKey(c.x, c.y),
          chunk = state.world.chunks[key]!;
        state.world = {
          ...state.world,
          chunks: {
            ...state.world.chunks,
            [key]: {
              ...chunk,
              deposits: chunk.deposits.map((p) =>
                p.id === d.id
                  ? {
                      ...p,
                      remainingQuantity: rounded(p.remainingQuantity - amount),
                    }
                  : p,
              ),
            },
          },
        };
        mine.quantity = rounded(mine.quantity + amount);
        drone.battery = rounded(drone.battery - 1);
        mineBuilding.status =
          d.remainingQuantity <= amount
            ? 'depleted'
            : mine.quantity >= settings.capacity
              ? 'storage-full'
              : 'running';
      }
    }
  }
  for (const mine of industry.mines) {
    const b = buildingById.get(mine.buildingId)!;
    const drone = industry.drones.find(
      (d) => d.job?.type === 'mine' && d.job.id === b.id,
    );
    if (b.status === 'no-drone' && drone)
      b.status =
        drone.activity === 'blocked'
          ? 'route-blocked'
          : ['charging', 'returning'].includes(drone.activity)
            ? 'drone-charging'
            : 'drone-travelling';
  }
}

export function validateIndustry(
  state: ColonyState,
  ctx: z.RefinementCtx,
): void {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const { scans, drones, mines } = state.industry;
  const deposits = new Map(
    Object.values(state.world.chunks).flatMap((c) =>
      c.deposits.map((d) => [d.id, d] as const),
    ),
  );
  const buildings = new Map(state.buildings.map((b) => [b.id, b]));
  if (
    new Set(scans.map((s) => s.id)).size !== scans.length ||
    new Set(drones.map((d) => d.id)).size !== drones.length ||
    new Set(mines.map((m) => m.buildingId)).size !== mines.length ||
    new Set(mines.map((m) => m.depositId)).size !== mines.length
  )
    issue('Duplicate industry identity');
  const jobs = new Set<string>();
  for (const scan of scans) {
    const station = buildings.get(scan.stationId);
    if (
      station?.type !== 'survey-station' ||
      scan.from.x > scan.to.x ||
      scan.from.y > scan.to.y ||
      scan.to.x - scan.from.x >= 16 ||
      scan.to.y - scan.from.y >= 16 ||
      [scan.from, scan.to].some(
        (t) => Math.abs(t.x - station.x) > 64 || Math.abs(t.y - station.y) > 64,
      ) ||
      scan.cursor > scanArea(scan) ||
      scan.progress >= scanDefinitions[scan.mode].ticks ||
      (scan.status === 'complete') !== (scan.cursor === scanArea(scan)) ||
      !/^scan-[1-9][0-9]*$/.test(scan.id) ||
      Number(scan.id.slice(5)) >= state.industry.nextScanId
    )
      issue('Invalid survey region or progress');
  }
  const occupied = new Set(
    state.buildings.flatMap((b) => cells(b).map(tileKey)),
  );
  for (const d of drones) {
    if (
      buildings.get(d.stationId)?.type !== 'survey-station' ||
      (d.id !== `${d.stationId}-${d.kind}` &&
        (!/^produced-[1-9][0-9]*$/.test(d.id) ||
          Number(d.id.slice(9)) >= state.production.nextDroneId)) ||
      d.battery > droneDefinitions[d.kind].capacity ||
      (d.kind === 'extractor' && occupied.has(tileKey(d.position)))
    )
      issue('Invalid drone or station');
    if (d.job) {
      const key = `${d.job.type}:${d.job.id}`;
      if (jobs.has(key)) issue('Exclusive job assigned twice');
      jobs.add(key);
      if (d.job.type === 'scan') {
        const s = scans.find((s) => s.id === d.job!.id);
        if (
          d.kind !== 'survey' ||
          !s ||
          s.stationId !== d.stationId ||
          s.status !== 'active'
        )
          issue('Invalid survey assignment');
      } else if (
        d.kind !== 'extractor' ||
        !mines.some((m) => m.buildingId === d.job!.id)
      )
        issue('Invalid mine assignment');
    }
  }
  for (const s of scans)
    if ((s.status === 'active') !== jobs.has(`scan:${s.id}`))
      issue('Survey assignment missing');
  for (const b of state.buildings) {
    if (
      b.type === 'survey-station' &&
      (drones.filter((d) => d.stationId === b.id).length >
        droneFleetLimits.station ||
        !(['survey', 'extractor'] as const).every((kind) =>
          drones.some(
            (d) =>
              d.id === `${b.id}-${kind}` &&
              d.kind === kind &&
              d.stationId === b.id,
          ),
        ))
    )
      issue('Station drone complement missing');
    if (isMine(b.type) && !mines.some((m) => m.buildingId === b.id))
      issue('Mine inventory missing');
  }
  for (const m of mines) {
    const b = buildings.get(m.buildingId),
      d = deposits.get(m.depositId);
    if (
      !b ||
      !isMine(b.type) ||
      !d ||
      !d.discovered ||
      !same(b, d) ||
      d.technology !== extractionDefinitions[b.type].technology ||
      d.depth > extractionDefinitions[b.type].maxDepth ||
      m.quantity > extractionDefinitions[b.type].capacity ||
      m.quantity > d.initialQuantity - d.remainingQuantity + 1e-5
    )
      issue('Invalid mine deposit or inventory conservation');
  }
}
