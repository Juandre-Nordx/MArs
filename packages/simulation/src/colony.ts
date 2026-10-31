import { z } from 'zod';
import {
  buildingDefinitions,
  buildingTypeSchema,
  emptyStock,
  landingCargo,
  populationRates,
  resourceKeys,
  SOL_TICKS,
  stockSchema,
  WORLD_SIZE,
  type BuildingType,
  type Resource,
  type Stock,
} from './catalog.js';
import { findLandingZone, type Tile } from './terrain.js';
import {
  aggregateStores,
  deposit,
  distributeCargo,
  emptyStores,
  infrastructureDefinitions,
  infrastructureSchema,
  infrastructureTypeSchema,
  isUsable,
  networkFor,
  networkSchema,
  port,
  rebuildNetworks,
  reserve,
  room,
  routePreview,
  segmentId,
  starterInfrastructure,
  storesSchema,
  withdraw,
  type InfrastructureType,
  type Segment,
  type Utility,
} from './networks.js';
export const SCHEMA_VERSION = 3 as const;
export const STEP_MS = 1000;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const buildingSchema = z
  .object({
    id: z.string().min(1),
    type: buildingTypeSchema,
    x: integer,
    y: integer,
    health: z.number().min(0).max(100),
    enabled: z.boolean(),
    workers: integer,
    priority: integer.max(100),
    stores: storesSchema,
    status: z.enum([
      'ready',
      'running',
      'disabled',
      'no-power',
      'no-input',
      'storage-full',
      'no-workers',
      'no-water-connection',
      'no-oxygen-connection',
      'no-power-connection',
    ]),
  })
  .strict();
export type Building = z.infer<typeof buildingSchema>;
const telemetrySchema = z
  .object({
    generated: z.number().finite().nonnegative(),
    demand: z.number().finite().nonnegative(),
    used: z.number().finite().nonnegative(),
    batteryDelta: z.number().finite(),
    produced: stockSchema,
    consumed: stockSchema,
    unmet: stockSchema,
  })
  .strict();
export const blankTelemetry = (): z.infer<typeof telemetrySchema> => ({
  generated: 0,
  demand: 0,
  used: 0,
  batteryDelta: 0,
  produced: emptyStock(),
  consumed: emptyStock(),
  unmet: emptyStock(),
});
const baseColonySchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    seed: integer,
    tick: integer,
    name: z.string().min(1).max(64),
    inventory: stockSchema,
    phase: z.enum(['landing', 'active']),
    landingZone: z.object({ x: integer, y: integer }).strict(),
    buildings: z.array(buildingSchema).max(400),
    population: integer.max(1000),
    credits: z.number().finite().nonnegative(),
    speed: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]),
    nextBuildingId: integer,
    telemetry: telemetrySchema,
    networkRulesVersion: z.literal(1),
    infrastructure: z.array(infrastructureSchema).max(1600),
    networks: z.array(networkSchema).max(1600),
  })
  .strict();
export type ColonyState = z.infer<typeof baseColonySchema>;
export function footprint(type: BuildingType, position: Tile): Tile[] {
  const definition = buildingDefinitions[type];
  return Array.from(
    { length: definition.width * definition.height },
    (_, index) => ({
      x: position.x + (index % definition.width),
      y: position.y + Math.floor(index / definition.width),
    }),
  );
}
export function buildingAt(
  state: ColonyState,
  tile: Tile,
): Building | undefined {
  return state.buildings.find((building) =>
    footprint(building.type, building).some(
      (cell) => cell.x === tile.x && cell.y === tile.y,
    ),
  );
}
export function capacities(state: ColonyState): Stock {
  const result = emptyStock();
  // Cargo remains inside Starship during descent; full capacities apply at deployment.
  if (state.phase === 'landing') return { ...landingCargo };
  for (const building of state.buildings)
    if (building.health > 0)
      for (const key of resourceKeys)
        result[key] += buildingDefinitions[building.type].capacity[key] ?? 0;
  return result;
}
export function accessible(buildings: Building[]): boolean {
  const occupied = new Set(
    buildings.flatMap((b) => footprint(b.type, b).map((t) => `${t.x},${t.y}`)),
  );
  const entry = Array.from({ length: WORLD_SIZE }, (_, x) => ({ x, y: 0 }))
    .concat(Array.from({ length: WORLD_SIZE }, (_, y) => ({ x: 0, y })))
    .find((t) => !occupied.has(`${t.x},${t.y}`));
  if (!entry) return buildings.length === 0;
  const queue: Tile[] = [entry];
  const reached = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i]!;
    const key = `${cell.x},${cell.y}`;
    if (
      cell.x < 0 ||
      cell.y < 0 ||
      cell.x >= WORLD_SIZE ||
      cell.y >= WORLD_SIZE ||
      reached.has(key) ||
      occupied.has(key)
    )
      continue;
    reached.add(key);
    queue.push(
      { x: cell.x + 1, y: cell.y },
      { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x, y: cell.y - 1 },
    );
  }
  return buildings.every((b) =>
    footprint(b.type, b).some((t) =>
      [
        { x: t.x + 1, y: t.y },
        { x: t.x - 1, y: t.y },
        { x: t.x, y: t.y + 1 },
        { x: t.x, y: t.y - 1 },
      ].some((n) => reached.has(`${n.x},${n.y}`)),
    ),
  );
}
export const colonySchema = baseColonySchema.superRefine((state, context) => {
  const expectedZone = findLandingZone(state.seed);
  if (
    state.landingZone.x !== expectedZone.x ||
    state.landingZone.y !== expectedZone.y
  )
    context.addIssue({
      code: 'custom',
      message: 'Invalid landing zone for world seed',
    });
  const ids = new Set<string>();
  const tiles = new Set<string>();
  for (const building of state.buildings) {
    if (ids.has(building.id))
      context.addIssue({ code: 'custom', message: 'Duplicate building ID' });
    ids.add(building.id);
    for (const tile of footprint(building.type, building)) {
      const key = `${tile.x},${tile.y}`;
      if (tile.x >= WORLD_SIZE || tile.y >= WORLD_SIZE || tiles.has(key))
        context.addIssue({
          code: 'custom',
          message: 'Invalid building footprint',
        });
      tiles.add(key);
    }
    if (building.workers > buildingDefinitions[building.type].workers)
      context.addIssue({
        code: 'custom',
        message: 'Invalid worker assignment',
      });
  }
  if (state.phase === 'landing' && state.buildings.length)
    context.addIssue({
      code: 'custom',
      message: 'Landing must not contain deployed buildings',
    });
  if (
    state.phase === 'active' &&
    (state.buildings.filter((b) => b.type === 'starship').length !== 1 ||
      !accessible(state.buildings))
  )
    context.addIssue({ code: 'custom', message: 'Invalid deployed colony' });
  if (state.buildings.reduce((sum, b) => sum + b.workers, 0) > state.population)
    context.addIssue({
      code: 'custom',
      message: 'Worker assignments exceed population',
    });
  const segmentIds = new Set<string>();
  for (const segment of state.infrastructure) {
    if (
      segment.id !== segmentId(segment.type, segment) ||
      segmentIds.has(segment.id) ||
      buildingAt(state, segment) ||
      segment.paidMetal > infrastructureDefinitions[segment.type].metal
    )
      context.addIssue({
        code: 'custom',
        message: 'Invalid infrastructure segment',
      });
    segmentIds.add(segment.id);
  }
  for (const building of state.buildings)
    for (const key of ['water', 'oxygen', 'energy'] as const)
      if (
        building.stores[key] >
        (buildingDefinitions[building.type].capacity[key] ?? 0) + 1e-9
      )
        context.addIssue({
          code: 'custom',
          message: 'Building storage capacity exceeded',
        });
  if (state.phase === 'active') {
    for (const key of ['water', 'oxygen', 'energy'] as const)
      if (
        Math.abs(
          state.inventory[key] -
            state.buildings.reduce((sum, b) => sum + b.stores[key], 0),
        ) > 0.000001
      )
        context.addIssue({
          code: 'custom',
          message: 'Aggregate inventory does not match physical stores',
        });
    const topology = (networks: ColonyState['networks']) =>
      networks.map(
        ({ id, type, segments, buildings, producers, storage, consumers }) => ({
          id,
          type,
          segments,
          buildings,
          producers,
          storage,
          consumers,
        }),
      );
    if (
      JSON.stringify(topology(rebuildNetworks(state))) !==
      JSON.stringify(topology(state.networks))
    )
      context.addIssue({
        code: 'custom',
        message: 'Network topology is stale',
      });
  } else if (state.infrastructure.length || state.networks.length)
    context.addIssue({
      code: 'custom',
      message: 'Infrastructure must await deployment',
    });
  const cap = capacities(state);
  for (const key of resourceKeys)
    if (state.inventory[key] > cap[key] + 1e-9)
      context.addIssue({
        code: 'custom',
        message: `Capacity exceeded: ${key}`,
      });
});
function makeBuilding(
  id: string,
  type: BuildingType,
  position: Tile,
): Building {
  return {
    id,
    type,
    ...position,
    health: 100,
    enabled: true,
    workers: buildingDefinitions[type].workers,
    status: 'ready',
    priority: buildingDefinitions[type].priority,
    stores: emptyStores(),
  };
}
function assignWorkers(buildings: Building[], population: number): Building[] {
  let available = population;
  return buildings.map((b) => {
    const required = buildingDefinitions[b.type].workers;
    const workers =
      b.enabled && b.health > 0 && available >= required ? required : 0;
    available -= workers;
    return { ...b, workers, stores: { ...b.stores } };
  });
}
export function newGame(seed = 1): ColonyState {
  return colonySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    seed,
    tick: 0,
    name: 'First Colony',
    inventory: { ...landingCargo },
    phase: 'landing',
    landingZone: findLandingZone(seed),
    buildings: [],
    population: 10,
    credits: 100,
    speed: 1,
    nextBuildingId: 1,
    telemetry: blankTelemetry(),
    networkRulesVersion: 1,
    infrastructure: [],
    networks: [],
  });
}
export function deployColony(state: ColonyState): ColonyState {
  if (state.phase === 'active') return state;
  const dx = state.landingZone.x - 9;
  const dy = state.landingZone.y - 9;
  const manifest: { type: BuildingType; x: number; y: number }[] = [
    { type: 'starship', x: 9, y: 9 },
    ...Array.from({ length: 10 }, (_, index) => ({
      type: 'housing' as const,
      x: 4 + index,
      y: 6,
    })),
    { type: 'oxygen-generator', x: 4, y: 9 },
    { type: 'oxygen-tank', x: 4, y: 12 },
    { type: 'water-recycler', x: 6, y: 9 },
    { type: 'water-tank', x: 6, y: 12 },
    { type: 'farm', x: 12, y: 10 },
    { type: 'solar', x: 4, y: 15 },
    { type: 'battery', x: 9, y: 15 },
    { type: 'warehouse', x: 12, y: 14 },
  ];
  const deployed: ColonyState = {
    ...state,
    inventory: { ...state.inventory },
    phase: 'active',
    buildings: manifest.map((item, index) =>
      makeBuilding(`starter-${index}`, item.type, {
        x: item.x + dx,
        y: item.y + dy,
      }),
    ),
  };
  distributeCargo(deployed);
  deployed.infrastructure = starterInfrastructure(deployed.buildings);
  return colonySchema.parse(refreshNetworks(deployed));
}
export function placement(
  state: ColonyState,
  type: BuildingType,
  tile: Tile,
): { valid: boolean; reason: string } {
  if (state.phase !== 'active')
    return { valid: false, reason: 'Wait for touchdown' };
  if (type === 'starship')
    return { valid: false, reason: 'Only one command centre is permitted' };
  if (
    !Number.isInteger(tile.x) ||
    !Number.isInteger(tile.y) ||
    footprint(type, tile).some(
      (t) => t.x < 0 || t.y < 0 || t.x >= WORLD_SIZE || t.y >= WORLD_SIZE,
    )
  )
    return { valid: false, reason: 'Outside map boundary' };
  if (footprint(type, tile).some((cell) => buildingAt(state, cell)))
    return { valid: false, reason: 'Building footprint is occupied' };
  if (
    footprint(type, tile).some((cell) =>
      state.infrastructure.some(
        (segment) => segment.x === cell.x && segment.y === cell.y,
      ),
    )
  )
    return {
      valid: false,
      reason: 'Remove infrastructure from the footprint first',
    };
  const definition = buildingDefinitions[type];
  if (
    state.inventory.metal < definition.cost.metal ||
    state.credits < definition.cost.credits
  )
    return { valid: false, reason: 'Insufficient metal or credits' };
  if (!accessible([...state.buildings, makeBuilding('preview', type, tile)]))
    return { valid: false, reason: 'Placement blocks colony access' };
  return { valid: true, reason: 'Valid placement' };
}
export function construct(
  state: ColonyState,
  type: BuildingType,
  tile: Tile,
): ColonyState {
  const check = placement(state, type, tile);
  if (!check.valid) throw new Error(check.reason);
  let id = state.nextBuildingId;
  while (state.buildings.some((b) => b.id === `built-${id}`)) id++;
  const definition = buildingDefinitions[type];
  return colonySchema.parse(
    refreshNetworks({
      ...state,
      inventory: {
        ...state.inventory,
        metal: state.inventory.metal - definition.cost.metal,
      },
      credits: state.credits - definition.cost.credits,
      nextBuildingId: id + 1,
      buildings: assignWorkers(
        [...state.buildings, makeBuilding(`built-${id}`, type, tile)],
        state.population,
      ),
    }),
  );
}
export function setSpeed(
  state: ColonyState,
  speed: ColonyState['speed'],
): ColonyState {
  return {
    ...state,
    speed: z
      .union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)])
      .parse(speed),
  };
}
export function toggleBuilding(state: ColonyState, id: string): ColonyState {
  return refreshNetworks({
    ...state,
    buildings: assignWorkers(
      state.buildings.map((b) =>
        b.id === id
          ? {
              ...b,
              enabled: !b.enabled,
              status: b.enabled ? ('disabled' as const) : ('ready' as const),
            }
          : b,
      ),
      state.population,
    ),
  });
}
const round = (value: number) => Math.round(value * 1000000) / 1000000;
export function refreshNetworks(state: ColonyState): ColonyState {
  const next = {
    ...state,
    buildings: state.buildings.map((b) => ({ ...b, stores: { ...b.stores } })),
    networks: rebuildNetworks(state),
  };
  for (const building of next.buildings) {
    if (!isUsable(building)) {
      building.status = 'disabled';
      continue;
    }
    const missing = (['water', 'oxygen', 'power'] as const).find(
      (type) =>
        port(building, type) && !networkFor(next.networks, building.id, type),
    );
    if (missing) building.status = `no-${missing}-connection`;
    else if (building.status.endsWith('-connection')) building.status = 'ready';
  }
  return next;
}
export function buildInfrastructure(
  state: ColonyState,
  type: InfrastructureType,
  route: Tile[],
  demolish = false,
): ColonyState {
  infrastructureTypeSchema.parse(type);
  if (state.phase !== 'active') throw new Error('Wait for touchdown');
  const preview = routePreview(state, type, route, demolish);
  if (!preview.valid) throw new Error(preview.reason);
  const keys = new Set(preview.tiles.map((tile) => segmentId(type, tile)));
  let infrastructure: Segment[] = state.infrastructure.filter(
    (segment) => !keys.has(segment.id) || (!demolish && isUsable(segment)),
  );
  if (!demolish) {
    const ids = new Set(infrastructure.map((s) => s.id));
    infrastructure = [
      ...infrastructure,
      ...preview.tiles
        .filter((tile) => !ids.has(segmentId(type, tile)))
        .map((tile) => ({
          ...tile,
          id: segmentId(type, tile),
          type,
          health: 100,
          enabled: true,
          paidMetal: infrastructureDefinitions[type].metal,
        })),
    ];
  }
  return colonySchema.parse(
    refreshNetworks({
      ...state,
      infrastructure,
      inventory: {
        ...state.inventory,
        metal: round(state.inventory.metal - preview.cost + preview.refund),
      },
    }),
  );
}
export function toggleSegment(state: ColonyState, id: string): ColonyState {
  return refreshNetworks({
    ...state,
    infrastructure: state.infrastructure.map((s) =>
      s.id === id ? { ...s, enabled: !s.enabled } : s,
    ),
  });
}
export function setPowerPriority(
  state: ColonyState,
  id: string,
  priority: number,
): ColonyState {
  const value = z.number().int().min(0).max(100).parse(priority);
  return {
    ...state,
    buildings: state.buildings.map((b) =>
      b.id === id ? { ...b, priority: value } : b,
    ),
  };
}
export function step(input: ColonyState): ColonyState {
  if (input.phase !== 'active' || input.speed === 0) return input;
  const state: ColonyState = {
    ...input,
    tick: input.tick + 1,
    inventory: { ...input.inventory },
    buildings: assignWorkers(input.buildings, input.population),
    networks: input.networks.map((n) => ({
      ...n,
      supply: 0,
      demand: 0,
      allocated: 0,
      status: 'idle',
    })),
    telemetry: blankTelemetry(),
  };
  const stock = state.inventory;
  const cap = capacities(state);
  const telemetry = state.telemetry;
  const daylight = input.tick % SOL_TICKS < SOL_TICKS * 0.75;
  const byId = new Map(state.buildings.map((b) => [b.id, b]));
  const connected = new Map(
    state.networks.flatMap((n) =>
      n.buildings.map((id) => [`${n.type}:${id}`, n] as const),
    ),
  );
  const power = new Map<
    string,
    { generation: number; used: number; available: number }
  >();
  for (const network of state.networks) {
    if (network.type === 'power') {
      const generation = daylight
        ? network.producers.reduce((sum, id) => {
            const b = byId.get(id)!;
            return (
              sum + (isUsable(b) ? buildingDefinitions[b.type].generation : 0)
            );
          }, 0)
        : 0;
      power.set(network.id, {
        generation,
        used: 0,
        available: generation + reserve(state, network),
      });
      network.supply = generation + reserve(state, network);
      telemetry.generated += generation;
    } else if (network.type !== 'road')
      network.supply = reserve(state, network);
  }
  const channel = (key: Resource): Utility | null =>
    key === 'energy'
      ? 'power'
      : key === 'water' || key === 'oxygen'
        ? key
        : null;
  const net = (id: string, key: Resource) => {
    const type = channel(key);
    return type ? connected.get(`${type}:${id}`) : undefined;
  };
  const available = (id: string, key: Resource) => {
    const network = net(id, key);
    return channel(key) ? (network ? reserve(state, network) : 0) : stock[key];
  };
  const space = (id: string, key: Resource) => {
    const network = net(id, key);
    return channel(key)
      ? network
        ? room(state, network)
        : 0
      : cap[key] - stock[key];
  };
  const take = (id: string, key: Resource, value: number) => {
    const network = net(id, key);
    if (network) {
      withdraw(state, network, value);
      network.allocated += value;
    } else stock[key] -= value;
    telemetry.consumed[key] += value;
  };
  const add = (id: string, key: Resource, value: number) => {
    const network = net(id, key);
    if (network) {
      deposit(state, network, value);
      network.supply += value;
    } else stock[key] += value;
    telemetry.produced[key] += value;
  };
  const order = [...state.buildings].sort(
    (a, b) =>
      a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const building of order) {
    const definition = buildingDefinitions[building.type];
    if (!isUsable(building)) {
      building.status = 'disabled';
      continue;
    }
    const missing = (['water', 'oxygen', 'power'] as const).find(
      (type) =>
        port(building, type) && !connected.has(`${type}:${building.id}`),
    );
    for (const [key, value] of Object.entries(definition.inputs) as [
      Resource,
      number,
    ][]) {
      const network = net(building.id, key);
      if (network) network.demand += value;
    }
    const grid = connected.get(`power:${building.id}`);
    const electricity = grid ? power.get(grid.id) : undefined;
    if (grid) grid.demand += definition.power;
    telemetry.demand += definition.power;
    if (missing) {
      building.status = `no-${missing}-connection`;
      continue;
    }
    if (building.workers < definition.workers) {
      building.status = 'no-workers';
      continue;
    }
    if (
      definition.power > 0 &&
      (!electricity ||
        electricity.available - electricity.used + 1e-9 < definition.power)
    ) {
      building.status = 'no-power';
      continue;
    }
    const inputs = Object.entries(definition.inputs) as [Resource, number][];
    const outputs = Object.entries(definition.outputs) as [Resource, number][];
    if (
      inputs.some(([key, value]) => available(building.id, key) + 1e-9 < value)
    ) {
      building.status = 'no-input';
      continue;
    }
    if (
      outputs.some(
        ([key, value]) =>
          space(building.id, key) + (definition.inputs[key] ?? 0) + 1e-9 <
          value,
      )
    ) {
      building.status = 'storage-full';
      continue;
    }
    if (electricity && grid) {
      electricity.used += definition.power;
      grid.allocated += definition.power;
    }
    telemetry.used += definition.power;
    for (const [key, value] of inputs) take(building.id, key, value);
    for (const [key, value] of outputs) add(building.id, key, value);
    building.status =
      building.type === 'solar' && !daylight ? 'ready' : 'running';
  }
  // Utility consumption belongs to actual occupied habitats, never a global pipe pool.
  let housed = 0;
  for (const building of state.buildings
    .filter((b) => buildingDefinitions[b.type].housing && isUsable(b))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const occupants = Math.min(
      buildingDefinitions[building.type].housing,
      Math.max(0, state.population - housed),
    );
    housed += occupants;
    for (const key of ['water', 'oxygen'] as const) {
      const required = occupants * populationRates[key];
      const network = net(building.id, key);
      if (!network) continue;
      network.demand += required;
      const amount = Math.min(reserve(state, network), required);
      take(building.id, key, amount);
      const waste = key === 'water' ? 'wastewater' : 'carbonDioxide';
      const recovered = Math.min(
        cap[waste] - stock[waste],
        amount * (key === 'water' ? 0.75 : 1),
      );
      stock[waste] += recovered;
      telemetry.produced[waste] += recovered;
    }
  }
  for (const key of ['water', 'oxygen'] as const) {
    const recipeConsumption = state.buildings.reduce(
      (sum, b) =>
        sum +
        (b.status === 'running'
          ? (buildingDefinitions[b.type].inputs[key] ?? 0)
          : 0),
      0,
    );
    telemetry.unmet[key] = round(
      Math.max(
        0,
        state.population * populationRates[key] -
          (telemetry.consumed[key] - recipeConsumption),
      ),
    );
  }
  const food = Math.min(stock.food, state.population * populationRates.food);
  stock.food -= food;
  telemetry.consumed.food += food;
  telemetry.unmet.food = round(state.population * populationRates.food - food);
  const priorEnergy = stock.energy;
  for (const network of state.networks) {
    const electricity = power.get(network.id);
    if (electricity) {
      const difference = electricity.generation - electricity.used;
      if (difference >= 0)
        deposit(state, network, Math.min(room(state, network), difference));
      else withdraw(state, network, -difference);
    }
    if (network.type !== 'road') {
      network.stored = reserve(state, network);
      network.capacity = network.stored + room(state, network);
    }
    network.status =
      network.allocated + 1e-9 < network.demand
        ? network.supply + 1e-9 < network.demand
          ? 'shortage'
          : 'blocked'
        : network.demand || network.supply
          ? 'operational'
          : 'idle';
    for (const metric of [
      'supply',
      'demand',
      'allocated',
      'stored',
      'capacity',
    ] as const)
      network[metric] = round(network[metric]);
  }
  for (const b of state.buildings)
    for (const key of ['water', 'oxygen', 'energy'] as const)
      b.stores[key] = round(Math.max(0, b.stores[key]));
  aggregateStores(state);
  telemetry.batteryDelta = round(stock.energy - priorEnergy);
  for (const key of resourceKeys)
    stock[key] = round(Math.max(0, Math.min(cap[key], stock[key])));
  return state;
}
export type ClockState = { colony: ColonyState; remainderMs: number };
export function advance(clock: ClockState, elapsedMs: number): ClockState {
  if (
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    !Number.isFinite(clock.remainderMs) ||
    clock.remainderMs < 0 ||
    clock.remainderMs >= STEP_MS
  )
    throw new Error('Invalid clock duration');
  if (clock.colony.speed === 0 || clock.colony.phase !== 'active') return clock;
  const total = clock.remainderMs + elapsedMs * clock.colony.speed;
  const ticks = Math.floor(total / STEP_MS);
  if (!Number.isSafeInteger(clock.colony.tick + ticks))
    throw new Error('Clock overflow');
  let colony = clock.colony;
  for (let i = 0; i < ticks; i++) colony = step(colony);
  return { colony, remainderMs: total % STEP_MS };
}
export function alerts(state: ColonyState): string[] {
  if (state.phase === 'landing')
    return ['Landing in progress — simulation on hold'];
  const result: string[] = [];
  const cap = capacities(state);
  for (const key of ['oxygen', 'water', 'food', 'energy'] as const) {
    if (state.telemetry.unmet[key] > 0)
      result.push(`Critical: unmet ${key} demand`);
    else if (state.inventory[key] <= cap[key] * 0.2)
      result.push(`Low ${key} reserves`);
  }
  if (state.buildings.some((b) => b.status === 'no-power'))
    result.push('Insufficient power: facilities stopped');
  if (state.buildings.some((b) => b.status === 'no-workers'))
    result.push('Insufficient workers: facilities stopped');
  if (state.buildings.some((b) => b.status === 'no-input'))
    result.push('Production waiting for feedstock');
  for (const type of ['water', 'oxygen', 'power'] as const) {
    const count = state.buildings.filter(
      (b) =>
        isUsable(b) && port(b, type) && !networkFor(state.networks, b.id, type),
    ).length;
    if (count) result.push(`No ${type} connection: ${count} building(s)`);
  }
  const housing = state.buildings.reduce(
    (sum, b) =>
      sum +
      (b.enabled && b.health > 0 ? buildingDefinitions[b.type].housing : 0),
    0,
  );
  if (housing < state.population) result.push('Insufficient housing');
  return result;
}
const legacyBuildingSchema = buildingSchema.omit({
  stores: true,
  priority: true,
});
const legacyColonySchema = baseColonySchema
  .omit({ infrastructure: true, networks: true, networkRulesVersion: true })
  .extend({
    schemaVersion: z.literal(2),
    buildings: z.array(legacyBuildingSchema).max(400),
  });
export function loadSave(value: unknown): ColonyState {
  const version = z
    .object({ schemaVersion: z.number() })
    .parse(value).schemaVersion;
  if (version === 3) {
    const state = baseColonySchema.parse(value);
    return colonySchema.parse(refreshNetworks(state));
  }
  if (version === 2) {
    const legacy = legacyColonySchema.parse(value);
    const state: ColonyState = {
      ...legacy,
      schemaVersion: 3,
      networkRulesVersion: 1,
      infrastructure: [],
      networks: [],
      buildings: legacy.buildings.map((b) => ({
        ...b,
        stores: emptyStores(),
        priority: buildingDefinitions[b.type].priority,
      })),
    };
    if (state.phase === 'active') {
      distributeCargo(state);
      state.infrastructure = starterInfrastructure(state.buildings);
    }
    return colonySchema.parse(refreshNetworks(state));
  }
  if (version !== 1) throw new Error('Unsupported save schema version');
  const legacy = z
    .object({
      schemaVersion: z.literal(1),
      seed: integer,
      tick: integer,
      name: z.string().min(1).max(64),
      inventory: z
        .object({
          water: z.number().finite().nonnegative().max(200),
          oxygen: z.number().finite().nonnegative().max(200),
          metal: z.number().finite().nonnegative().max(400),
        })
        .strict(),
    })
    .strict()
    .parse(value);
  const state = deployColony(newGame(legacy.seed));
  state.name = legacy.name;
  state.tick = legacy.tick;
  state.inventory = { ...emptyStock(), ...legacy.inventory };
  state.credits = 0;
  distributeCargo(state);
  return colonySchema.parse(refreshNetworks(state));
}
