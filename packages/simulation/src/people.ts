import { z } from 'zod';
import {
  buildingDefinitions,
  populationRates,
  SOL_TICKS,
  WORLD_SIZE,
} from './catalog.js';
import {
  adjacent,
  cells,
  connectionTiles,
  isUsable,
  networkFor,
  port,
  reserve,
  tileKey,
} from './networks.js';
import type { ColonyState, Building } from './colony.js';
import type { Tile } from './terrain.js';
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
export const residentSchema = z
  .object({
    id: z.string().min(1),
    homeId: z.string().nullable(),
    position: tileSchema,
    previousPosition: tileSchema,
    route: z.array(tileSchema).max(400),
    destinationId: z.string().nullable(),
    activity: z.enum(['walking', 'resting', 'waiting']),
    waitTicks: z.number().int().min(0).max(100),
    trips: z.number().int().nonnegative(),
  })
  .strict();
export type Resident = z.infer<typeof residentSchema>;
export const immigrationSchema = z
  .object({
    enabled: z.boolean(),
    nextCheckTick: z.number().int().nonnegative(),
    lastEvent: z.string().max(200),
    convoy: z
      .object({
        id: z.string(),
        homeId: z.string(),
        position: tileSchema,
        previousPosition: tileSchema,
        route: z.array(tileSchema).max(400),
        exit: tileSchema,
        phase: z.enum(['arriving', 'departing']),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const RESERVE_TICKS = 30;
export const ARRIVAL_INTERVAL = 60;
export const initialImmigration = (
  tick = 0,
): z.infer<typeof immigrationSchema> => ({
  enabled: true,
  nextCheckTick: tick + 30,
  lastEvent: 'Build a connected home to welcome a newcomer',
  convoy: null,
});
function grid(state: Pick<ColonyState, 'buildings' | 'infrastructure'>) {
  return {
    blocked: new Set(state.buildings.flatMap((b) => cells(b).map(tileKey))),
    roads: new Set(
      state.infrastructure
        .filter((s) => s.type === 'road' && isUsable(s))
        .map(tileKey),
    ),
  };
}
function valid(t: Tile) {
  return t.x >= 0 && t.y >= 0 && t.x < WORLD_SIZE && t.y < WORLD_SIZE;
}
export function walkingPath(
  state: Pick<ColonyState, 'buildings' | 'infrastructure'>,
  from: Tile,
  to: Tile,
): Tile[] | null {
  const { blocked, roads } = grid(state);
  if (
    !valid(from) ||
    !valid(to) ||
    blocked.has(tileKey(to)) ||
    blocked.has(tileKey(from))
  )
    return null;
  const costs = new Map([[tileKey(from), 0]]),
    parents = new Map<string, Tile>(),
    queue = [{ ...from, cost: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x);
    const current = queue.shift()!;
    if (current.cost !== costs.get(tileKey(current))) continue;
    if (current.x === to.x && current.y === to.y) {
      const result: Tile[] = [];
      let p: Tile = current;
      while (tileKey(p) !== tileKey(from)) {
        result.push({ x: p.x, y: p.y });
        p = parents.get(tileKey(p))!;
      }
      return result.reverse();
    }
    for (const next of adjacent(current)) {
      if (!valid(next) || blocked.has(tileKey(next))) continue;
      const cost = current.cost + (roads.has(tileKey(next)) ? 1 : 3),
        key = tileKey(next);
      if (cost < (costs.get(key) ?? Infinity)) {
        costs.set(key, cost);
        parents.set(key, current);
        queue.push({ ...next, cost });
      }
    }
  }
  return null;
}
export function door(
  state: Pick<ColonyState, 'buildings'> &
    Partial<Pick<ColonyState, 'infrastructure'>>,
  building: Building,
): Tile | null {
  const blocked = new Set(
    state.buildings.flatMap((b) => cells(b).map(tileKey)),
  );
  const preferred = port(building, 'road');
  const entries = connectionTiles(building, 'road').filter(
    (t) => !blocked.has(tileKey(t)),
  );
  const roads = new Set(
    (state.infrastructure ?? [])
      .filter((s) => s.type === 'road' && isUsable(s))
      .map(tileKey),
  );
  if (
    preferred &&
    roads.has(tileKey(preferred)) &&
    !blocked.has(tileKey(preferred))
  )
    return preferred;
  const roadEntry = entries.find((t) => roads.has(tileKey(t)));
  if (roadEntry) return roadEntry;
  return preferred && valid(preferred) && !blocked.has(tileKey(preferred))
    ? preferred
    : (entries[0] ?? null);
}
export function createResidents(
  state: Pick<ColonyState, 'population' | 'buildings' | 'landingZone'>,
): Resident[] {
  const homes = state.buildings.filter(
    (b) => buildingDefinitions[b.type].housing && isUsable(b),
  );
  const slots = homes.flatMap((b) =>
    Array.from({ length: buildingDefinitions[b.type].housing }, () => b),
  );
  const fallback =
    state.buildings
      .map((b) => door(state, b))
      .find((t): t is Tile => t !== null) ?? state.landingZone;
  return Array.from({ length: state.population }, (_, i) => {
    const home = slots[i],
      position = home ? (door(state, home) ?? fallback) : fallback;
    return {
      id: `colonist-${i + 1}`,
      homeId: home?.id ?? null,
      position: { ...position },
      previousPosition: { ...position },
      route: [],
      destinationId: null,
      activity: 'resting',
      waitTicks: 1 + (i % 5),
      trips: 0,
    };
  });
}
export function assignHomes(state: ColonyState): Resident[] {
  const occupancy = new Map<string, number>();
  const residents = state.residents.map((r) => {
    const home = state.buildings.find(
      (b) =>
        b.id === r.homeId &&
        isUsable(b) &&
        buildingDefinitions[b.type].housing > (occupancy.get(b.id) ?? 0),
    );
    if (home) {
      occupancy.set(home.id, (occupancy.get(home.id) ?? 0) + 1);
      return { ...r };
    }
    return { ...r, homeId: null };
  });
  for (const r of residents)
    if (!r.homeId) {
      const home = state.buildings.find(
        (b) =>
          isUsable(b) &&
          buildingDefinitions[b.type].housing > (occupancy.get(b.id) ?? 0),
      );
      if (home) {
        r.homeId = home.id;
        occupancy.set(home.id, (occupancy.get(home.id) ?? 0) + 1);
      }
    }
  return residents;
}
export function arrivalReadiness(
  state: ColonyState,
  requestedHome?: string,
): { ready: boolean; reason: string; homeId: string | null } {
  const fail = (reason: string) => ({ ready: false, reason, homeId: null });
  if (state.phase !== 'active') return fail('Waiting for touchdown');
  if (!state.immigration.enabled) return fail('Arrivals paused');
  if (state.residents.some((r) => !r.homeId))
    return fail('House existing residents first');
  const homes = state.buildings.filter(
    (b) =>
      isUsable(b) &&
      buildingDefinitions[b.type].housing >
        state.residents.filter((r) => r.homeId === b.id).length &&
      (!requestedHome || b.id === requestedHome),
  );
  if (!homes.length) return fail('Build another home: no vacant beds');
  if (
    state.inventory.food <
    (state.population + 1) * populationRates.food * RESERVE_TICKS
  )
    return fail('Need a 30-tick food reserve for everyone');
  if (
    ['water', 'oxygen', 'food'].some(
      (k) => state.telemetry.unmet[k as 'water' | 'oxygen' | 'food'] > 1e-9,
    )
  )
    return fail('Resolve current life-support shortages');
  if (
    state.buildings.some(
      (b) =>
        isUsable(b) &&
        buildingDefinitions[b.type].power > 0 &&
        (b.status === 'no-power' || b.status === 'no-power-connection'),
    )
  )
    return fail('Restore settlement power before new arrivals');
  let reason = 'Vacant home needs connected water, oxygen and power';
  for (const home of homes) {
    const networks = (['water', 'oxygen', 'power'] as const).map((type) =>
      networkFor(state.networks, home.id, type),
    );
    if (networks.some((n) => !n)) continue;
    let enough = true;
    for (const type of ['water', 'oxygen'] as const) {
      for (const network of state.networks.filter((n) => n.type === type)) {
        const residents = state.residents.filter(
          (r) => r.homeId && network.buildings.includes(r.homeId),
        ).length;
        const incoming = network.buildings.includes(home.id) ? 1 : 0;
        const productionInputs = state.buildings
          .filter((b) => isUsable(b) && network.buildings.includes(b.id))
          .reduce(
            (sum, b) => sum + (buildingDefinitions[b.type].inputs[type] ?? 0),
            0,
          );
        if (
          reserve(state, network) + 1e-9 <
          ((residents + incoming) * populationRates[type] + productionInputs) *
            RESERVE_TICKS
        ) {
          enough = false;
          reason = `Need a 30-tick ${type} reserve in connected networks`;
          break;
        }
      }
    }
    const power = networks[2]!;
    const demand = state.buildings
      .filter((b) => isUsable(b) && power.buildings.includes(b.id))
      .reduce((sum, b) => sum + buildingDefinitions[b.type].power, 0);
    const solar =
      state.tick % SOL_TICKS < SOL_TICKS * 0.75
        ? state.buildings
            .filter((b) => isUsable(b) && power.producers.includes(b.id))
            .reduce((sum, b) => sum + buildingDefinitions[b.type].generation, 0)
        : 0;
    if (
      solar + 1e-9 < demand &&
      reserve(state, power) + 1e-9 < demand * RESERVE_TICKS
    ) {
      enough = false;
      reason = 'Need connected generation or a 30-tick battery reserve';
    }
    if (enough && door(state, home))
      return {
        ready: true,
        reason: 'Connected home and safety reserves available',
        homeId: home.id,
      };
  }
  return fail(reason);
}
export function toggleArrivals(state: ColonyState): ColonyState {
  return {
    ...state,
    immigration: { ...state.immigration, enabled: !state.immigration.enabled },
  };
}
function entryPath(
  state: ColonyState,
  target: Tile,
): { entry: Tile; route: Tile[] } | null {
  const entries: Tile[] = [];
  for (let i = 0; i < WORLD_SIZE; i++)
    entries.push(
      { x: 0, y: i },
      { x: WORLD_SIZE - 1, y: i },
      { x: i, y: 0 },
      { x: i, y: WORLD_SIZE - 1 },
    );
  entries.sort(
    (a, b) =>
      Number(!(a.x === 0 && a.y === WORLD_SIZE - 1)) -
        Number(!(b.x === 0 && b.y === WORLD_SIZE - 1)) ||
      Math.abs(a.x - target.x) +
        Math.abs(a.y - target.y) -
        Math.abs(b.x - target.x) -
        Math.abs(b.y - target.y) ||
      a.y - b.y ||
      a.x - b.x,
  );
  for (const entry of entries) {
    const route = walkingPath(state, entry, target);
    if (route) return { entry, route };
  }
  return null;
}
export function advanceResidents(state: ColonyState): ColonyState {
  const blocked = grid(state).blocked;
  const residents = assignHomes(state).map((r) => {
    const next: Resident = {
      ...r,
      position: { ...r.position },
      previousPosition: { ...r.position },
      route: [...r.route],
    };
    const destination = state.buildings.find(
      (b) => b.id === next.destinationId && isUsable(b),
    );
    if (
      next.route.length &&
      (!destination || blocked.has(tileKey(next.route[0]!)))
    ) {
      next.route = [];
      next.waitTicks = 1;
    }
    if (next.route.length) {
      next.position = next.route.shift()!;
      next.activity = 'walking';
      if (!next.route.length) {
        next.activity = 'resting';
        next.waitTicks = 3;
      }
      return next;
    }
    if (next.waitTicks > 0) {
      next.waitTicks--;
      next.activity = 'resting';
      return next;
    }
    const visits = state.buildings.filter(
      (b) => isUsable(b) && b.type !== 'housing',
    );
    const home = state.buildings.find((b) => b.id === next.homeId);
    const index = Number(next.id.split('-').at(-1)) || 0;
    const target =
      next.trips % 2 && home
        ? home
        : visits[(index + next.trips) % visits.length];
    next.trips++;
    const endpoint = target ? door(state, target) : null;
    const path = endpoint ? walkingPath(state, next.position, endpoint) : null;
    next.destinationId = target?.id ?? null;
    next.route = path ?? [];
    next.activity = next.route.length
      ? 'walking'
      : path
        ? 'resting'
        : 'waiting';
    next.waitTicks = next.route.length ? 0 : 3;
    return next;
  });
  const immigration = {
    ...state.immigration,
    convoy: state.immigration.convoy
      ? {
          ...state.immigration.convoy,
          position: { ...state.immigration.convoy.position },
          previousPosition: { ...state.immigration.convoy.position },
          route: [...state.immigration.convoy.route],
        }
      : null,
  };
  let nextId = state.nextResidentId;
  const convoy = immigration.convoy;
  if (convoy) {
    const next = convoy.route[0];
    if (next && blocked.has(tileKey(next))) {
      const home = state.buildings.find((b) => b.id === convoy.homeId);
      const target =
        convoy.phase === 'departing'
          ? convoy.exit
          : home
            ? door(state, home)
            : null;
      convoy.route = target
        ? (walkingPath(state, convoy.position, target) ?? [])
        : [];
    }
    if (convoy.route.length) convoy.position = convoy.route.shift()!;
    if (!convoy.route.length) {
      if (convoy.phase === 'arriving') {
        const readiness = arrivalReadiness(
          { ...state, residents },
          convoy.homeId,
        );
        const home = state.buildings.find((b) => b.id === convoy.homeId);
        const endpoint = home
          ? connectionTiles(home, 'road').find(
              (t) =>
                tileKey(t) === tileKey(convoy.position) &&
                !blocked.has(tileKey(t)),
            )
          : null;
        if (
          readiness.ready &&
          endpoint &&
          tileKey(endpoint) === tileKey(convoy.position)
        ) {
          residents.push({
            id: `colonist-${nextId}`,
            homeId: home!.id,
            position: { ...convoy.position },
            previousPosition: { ...convoy.position },
            route: [],
            destinationId: null,
            activity: 'resting',
            waitTicks: 3,
            trips: 0,
          });
          nextId++;
          immigration.lastEvent = 'A newcomer moved in by buggy';
        } else
          immigration.lastEvent = `Buggy turned away: ${readiness.ready ? 'Approach blocked' : readiness.reason}`;
        convoy.phase = 'departing';
        convoy.route = walkingPath(state, convoy.position, convoy.exit) ?? [];
        immigration.nextCheckTick = state.tick + ARRIVAL_INTERVAL;
      } else if (tileKey(convoy.position) === tileKey(convoy.exit))
        immigration.convoy = null;
      else {
        convoy.route = walkingPath(state, convoy.position, convoy.exit) ?? [];
        if (!convoy.route.length)
          immigration.lastEvent = 'Buggy waiting for a clear exit route';
      }
    }
  } else if (state.tick >= immigration.nextCheckTick) {
    const readiness = arrivalReadiness({ ...state, residents });
    immigration.nextCheckTick = state.tick + 30;
    if (readiness.ready) {
      const home = state.buildings.find((b) => b.id === readiness.homeId)!;
      const endpoint = door(state, home)!;
      const path = entryPath(state, endpoint);
      if (path) {
        immigration.convoy = {
          id: `buggy-${nextId}`,
          homeId: home.id,
          position: path.entry,
          previousPosition: path.entry,
          route: path.route,
          exit: path.entry,
          phase: 'arriving',
        };
        immigration.lastEvent = 'One newcomer is arriving by buggy';
      } else
        immigration.lastEvent = 'Vacant home has no traversable buggy approach';
    } else immigration.lastEvent = readiness.reason;
  }
  return {
    ...state,
    residents,
    population: residents.length,
    nextResidentId: nextId,
    immigration,
  };
}
