import { z } from 'zod';
import {
  buildingDefinitions,
  WORLD_SIZE,
  type BuildingType,
  type Stock,
} from './catalog.js';
import type { Tile } from './terrain.js';
export const infrastructureTypeSchema = z.enum([
  'water',
  'oxygen',
  'power',
  'road',
]);
export type InfrastructureType = z.infer<typeof infrastructureTypeSchema>;
export type Utility = Exclude<InfrastructureType, 'road'>;
export const utilityResource = {
  water: 'water',
  oxygen: 'oxygen',
  power: 'energy',
} as const;
export const infrastructureDefinitions: Record<
  InfrastructureType,
  { name: string; color: number; metal: number; refund: number }
> = {
  water: { name: 'Water Pipe', color: 0x65bced, metal: 0.25, refund: 0.5 },
  oxygen: { name: 'Oxygen Pipe', color: 0x77e3c0, metal: 0.25, refund: 0.5 },
  power: { name: 'Electrical Cable', color: 0xffc35b, metal: 0.5, refund: 0.5 },
  road: { name: 'Road', color: 0xb4a998, metal: 1, refund: 0.5 },
};
export const infrastructureSchema = z
  .object({
    id: z.string(),
    type: infrastructureTypeSchema,
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
    health: z.number().finite().min(0).max(100),
    enabled: z.boolean(),
    paidMetal: z.number().finite().nonnegative(),
  })
  .strict();
export type Segment = z.infer<typeof infrastructureSchema>;
export const storesSchema = z
  .object({
    water: z.number().finite().nonnegative(),
    oxygen: z.number().finite().nonnegative(),
    energy: z.number().finite().nonnegative(),
  })
  .strict();
export const emptyStores = () => ({ water: 0, oxygen: 0, energy: 0 });
export type NetworkBuilding = {
  id: string;
  type: BuildingType;
  x: number;
  y: number;
  enabled: boolean;
  health: number;
  stores: z.infer<typeof storesSchema>;
};
export type NetworkState = {
  buildings: NetworkBuilding[];
  infrastructure: Segment[];
  inventory: Stock;
};
export const networkSchema = z
  .object({
    id: z.string(),
    type: infrastructureTypeSchema,
    segments: z.array(z.string()),
    buildings: z.array(z.string()),
    producers: z.array(z.string()),
    storage: z.array(z.string()),
    consumers: z.array(z.string()),
    supply: z.number().finite().nonnegative(),
    demand: z.number().finite().nonnegative(),
    allocated: z.number().finite().nonnegative(),
    stored: z.number().finite().nonnegative(),
    capacity: z.number().finite().nonnegative(),
    status: z.enum(['idle', 'operational', 'shortage', 'blocked']),
  })
  .strict();
export type Network = z.infer<typeof networkSchema>;
export const tileKey = (tile: Tile) => `${tile.x},${tile.y}`;
export const segmentId = (type: InfrastructureType, tile: Tile) =>
  `${type}:${tileKey(tile)}`;
export const adjacent = (tile: Tile): Tile[] => [
  { x: tile.x, y: tile.y - 1 },
  { x: tile.x + 1, y: tile.y },
  { x: tile.x, y: tile.y + 1 },
  { x: tile.x - 1, y: tile.y },
];
export function cells(
  building: Pick<NetworkBuilding, 'type' | 'x' | 'y'>,
): Tile[] {
  const d = buildingDefinitions[building.type];
  return Array.from({ length: d.width * d.height }, (_, i) => ({
    x: building.x + (i % d.width),
    y: building.y + Math.floor(i / d.width),
  }));
}
export function port(
  building: NetworkBuilding,
  type: InfrastructureType,
): Tile | null {
  if (type === 'road') return { x: building.x, y: building.y - 1 };
  const offset = buildingDefinitions[building.type].ports[type];
  return offset ? { x: building.x + offset.x, y: building.y + offset.y } : null;
}
// Resource pipes and roads attach to cardinal footprint edges; power retains its explicit port.
export function connectionTiles(
  building: NetworkBuilding,
  type: InfrastructureType,
): Tile[] {
  if (type === 'power') {
    const tile = port(building, type);
    return tile ? [tile] : [];
  }
  if (
    (type === 'water' || type === 'oxygen') &&
    !buildingDefinitions[building.type].ports[type]
  )
    return [];
  const footprint = new Set(cells(building).map(tileKey));
  return [
    ...new Map(
      cells(building)
        .flatMap(adjacent)
        .filter(
          (t) =>
            t.x >= 0 &&
            t.y >= 0 &&
            t.x < WORLD_SIZE &&
            t.y < WORLD_SIZE &&
            !footprint.has(tileKey(t)),
        )
        .map((t) => [tileKey(t), t]),
    ).values(),
  ];
}
export const isUsable = (value: { health: number; enabled: boolean }) =>
  value.health > 0 && value.enabled;
export function rebuildNetworks(state: NetworkState): Network[] {
  const networks: Network[] = [];
  for (const type of infrastructureTypeSchema.options) {
    const segments = state.infrastructure
      .filter((s) => s.type === type && isUsable(s))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const byTile = new Map(segments.map((s) => [tileKey(s), s]));
    const manifolds = new Map<string, Set<string>>();
    if (type === 'water' || type === 'oxygen')
      for (const building of state.buildings) {
        const contacts = connectionTiles(building, type)
          .map((t) => byTile.get(tileKey(t)))
          .filter((segment): segment is Segment => !!segment);
        for (const contact of contacts) {
          const peers = manifolds.get(contact.id) ?? new Set<string>();
          for (const other of contacts) peers.add(other.id);
          manifolds.set(contact.id, peers);
        }
      }
    const byId = new Map(segments.map((segment) => [segment.id, segment]));
    const seen = new Set<string>();
    for (const segment of segments) {
      if (seen.has(segment.id)) continue;
      const group: Segment[] = [];
      const queue = [segment];
      seen.add(segment.id);
      for (let i = 0; i < queue.length; i++) {
        const cell = queue[i]!;
        group.push(cell);
        for (const id of manifolds.get(cell.id) ?? []) {
          const peer = byId.get(id)!;
          if (!seen.has(id)) {
            seen.add(id);
            queue.push(peer);
          }
        }
        for (const tile of adjacent(cell)) {
          const next = byTile.get(tileKey(tile));
          if (next && !seen.has(next.id)) {
            seen.add(next.id);
            queue.push(next);
          }
        }
      }
      const keys = new Set(group.map(tileKey));
      const buildings = state.buildings
        .filter((b) => {
          if (type === 'road')
            return cells(b).some((t) =>
              adjacent(t).some((n) => keys.has(tileKey(n))),
            );
          return connectionTiles(b, type).some((tile) =>
            keys.has(tileKey(tile)),
          );
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const resource = type === 'road' ? null : utilityResource[type];
      const producers = buildings.filter(
        (b) =>
          resource &&
          (type === 'power'
            ? buildingDefinitions[b.type].generation > 0
            : (buildingDefinitions[b.type].outputs[resource] ?? 0) > 0),
      );
      const storage = buildings.filter(
        (b) =>
          resource && (buildingDefinitions[b.type].capacity[resource] ?? 0) > 0,
      );
      const consumers = buildings.filter((b) =>
        type === 'road'
          ? false
          : type === 'power'
            ? buildingDefinitions[b.type].power > 0
            : buildingDefinitions[b.type].housing > 0 ||
              (buildingDefinitions[b.type].inputs[type] ?? 0) > 0,
      );
      const available = resource
        ? storage
            .filter(isUsable)
            .reduce((sum, b) => sum + b.stores[resource], 0)
        : 0;
      networks.push({
        id: `net-${segment.id}`,
        type,
        segments: group.map((s) => s.id).sort(),
        buildings: buildings.map((b) => b.id),
        producers: producers.map((b) => b.id),
        storage: storage.map((b) => b.id),
        consumers: consumers.map((b) => b.id),
        supply: available,
        demand: 0,
        allocated: 0,
        stored: available,
        capacity: resource
          ? storage
              .filter(isUsable)
              .reduce(
                (sum, b) =>
                  sum + (buildingDefinitions[b.type].capacity[resource] ?? 0),
                0,
              )
          : 0,
        status: 'idle',
      });
    }
  }
  return networks;
}
export function networkFor(
  networks: Network[],
  buildingId: string,
  type: InfrastructureType,
) {
  return networks.find(
    (n) => n.type === type && n.buildings.includes(buildingId),
  );
}
export function networkStorage(state: NetworkState, network: Network) {
  return state.buildings
    .filter((b) => network.storage.includes(b.id) && isUsable(b))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function reserve(state: NetworkState, network: Network): number {
  if (network.type === 'road') return 0;
  const key = utilityResource[network.type];
  return networkStorage(state, network).reduce(
    (sum, b) => sum + b.stores[key],
    0,
  );
}
export function room(state: NetworkState, network: Network): number {
  if (network.type === 'road') return 0;
  const key = utilityResource[network.type];
  return networkStorage(state, network).reduce(
    (sum, b) =>
      sum + (buildingDefinitions[b.type].capacity[key] ?? 0) - b.stores[key],
    0,
  );
}
export function withdraw(
  state: NetworkState,
  network: Network,
  requested: number,
): number {
  if (network.type === 'road' || requested < 0 || !Number.isFinite(requested))
    throw new Error('Invalid network withdrawal');
  let remaining = requested;
  const key = utilityResource[network.type];
  for (const building of networkStorage(state, network)) {
    const take = Math.min(building.stores[key], remaining);
    building.stores[key] -= take;
    remaining -= take;
  }
  return requested - remaining;
}
export function deposit(
  state: NetworkState,
  network: Network,
  amount: number,
): number {
  if (network.type === 'road' || amount < 0 || !Number.isFinite(amount))
    throw new Error('Invalid network deposit');
  let remaining = amount;
  const key = utilityResource[network.type];
  for (const building of networkStorage(state, network)) {
    const add = Math.min(
      (buildingDefinitions[building.type].capacity[key] ?? 0) -
        building.stores[key],
      remaining,
    );
    building.stores[key] += add;
    remaining -= add;
  }
  return amount - remaining;
}
export function aggregateStores(state: NetworkState): void {
  for (const key of ['water', 'oxygen', 'energy'] as const)
    state.inventory[key] =
      Math.round(
        state.buildings.reduce((sum, b) => sum + b.stores[key], 0) * 1e6,
      ) / 1e6;
}
// Scenario/migration-only allocation: moves existing aggregate cargo into physical containers.
export function distributeCargo(state: NetworkState): void {
  for (const key of ['water', 'oxygen', 'energy'] as const) {
    let remaining = state.inventory[key];
    const buildings = [...state.buildings].sort(
      (a, b) =>
        (a.type === 'starship' ? 1 : 0) - (b.type === 'starship' ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    for (const b of buildings) {
      const amount = Math.min(
        buildingDefinitions[b.type].capacity[key] ?? 0,
        remaining,
      );
      b.stores[key] = amount;
      remaining -= amount;
    }
    if (remaining > 1e-9)
      throw new Error(`Cannot preserve ${key}: insufficient storage`);
  }
}
export function starterInfrastructure(buildings: NetworkBuilding[]): Segment[] {
  const occupied = new Set(buildings.flatMap((b) => cells(b).map(tileKey)));
  const result: Segment[] = [];
  for (const type of infrastructureTypeSchema.options) {
    const targets = buildings
      .map((b) => port(b, type))
      .filter((t): t is Tile => t !== null)
      .filter(
        (t) =>
          t.x >= 0 &&
          t.y >= 0 &&
          t.x < WORLD_SIZE &&
          t.y < WORLD_SIZE &&
          !occupied.has(tileKey(t)),
      );
    const connected = new Map<string, Tile>();
    for (const target of targets) {
      if (!connected.size) {
        connected.set(tileKey(target), target);
        continue;
      }
      if (connected.has(tileKey(target))) continue;
      const queue = [target];
      const parents = new Map<string, Tile | null>([[tileKey(target), null]]);
      let found: Tile | null = null;
      for (let i = 0; i < queue.length && !found; i++) {
        const current = queue[i]!;
        if (connected.has(tileKey(current))) {
          found = current;
          break;
        }
        for (const next of adjacent(current))
          if (
            next.x >= 0 &&
            next.y >= 0 &&
            next.x < WORLD_SIZE &&
            next.y < WORLD_SIZE &&
            !occupied.has(tileKey(next)) &&
            !parents.has(tileKey(next))
          ) {
            parents.set(tileKey(next), current);
            queue.push(next);
          }
      }
      if (!found) continue; // Legacy colonies can enclose a port; report disconnection rather than move a building.
      let current: Tile | null = found;
      while (current) {
        connected.set(tileKey(current), current);
        current = parents.get(tileKey(current)) ?? null;
      }
    }
    for (const tile of connected.values())
      result.push({
        ...tile,
        id: segmentId(type, tile),
        type,
        health: 100,
        enabled: true,
        paidMetal: 0,
      });
  }
  return result;
}
export function routeBetween(start: Tile, end: Tile): Tile[] {
  const route = [{ ...start }];
  let x = start.x;
  let y = start.y;
  if (
    ![start.x, start.y, end.x, end.y].every(Number.isInteger) ||
    Math.abs(end.x - start.x) + Math.abs(end.y - start.y) > WORLD_SIZE * 2
  )
    return [];
  while (x !== end.x) {
    x += Math.sign(end.x - x);
    route.push({ x, y });
  }
  while (y !== end.y) {
    y += Math.sign(end.y - y);
    route.push({ x, y });
  }
  return route;
}
export function routePreview(
  state: NetworkState,
  type: InfrastructureType,
  route: Tile[],
  demolish = false,
): {
  valid: boolean;
  reason: string;
  cost: number;
  refund: number;
  tiles: Tile[];
} {
  const tiles = [...new Map(route.map((t) => [tileKey(t), t])).values()];
  const definition = infrastructureDefinitions[type];
  const fail = (reason: string) => ({
    valid: false,
    reason,
    cost: 0,
    refund: 0,
    tiles,
  });
  if (!tiles.length || tiles.length > WORLD_SIZE * WORLD_SIZE)
    return fail('Select a route');
  if (
    tiles.some(
      (t) =>
        !Number.isInteger(t.x) ||
        !Number.isInteger(t.y) ||
        t.x < 0 ||
        t.y < 0 ||
        t.x >= WORLD_SIZE ||
        t.y >= WORLD_SIZE,
    )
  )
    return fail('Outside map boundary');
  const selected = new Set(tiles.map(tileKey));
  const visited = new Set([tileKey(tiles[0]!)]);
  const queue = [tiles[0]!];
  for (let i = 0; i < queue.length; i++)
    for (const n of adjacent(queue[i]!))
      if (selected.has(tileKey(n)) && !visited.has(tileKey(n))) {
        visited.add(tileKey(n));
        queue.push(n);
      }
  if (visited.size !== tiles.length)
    return fail('Route must be cardinally connected');
  const occupied = new Set(
    state.buildings.flatMap((b) => cells(b).map(tileKey)),
  );
  if (tiles.some((t) => occupied.has(tileKey(t))))
    return fail('Building footprint is occupied');
  const existing = new Map(
    state.infrastructure
      .filter((s) => s.type === type)
      .map((s) => [tileKey(s), s]),
  );
  const cost = demolish
    ? 0
    : tiles.filter(
        (t) =>
          !existing.has(tileKey(t)) || !isUsable(existing.get(tileKey(t))!),
      ).length * definition.metal;
  const refund = demolish
    ? tiles.reduce((sum, t) => {
        const s = existing.get(tileKey(t));
        return (
          sum + (s ? (s.paidMetal * definition.refund * s.health) / 100 : 0)
        );
      }, 0)
    : 0;
  if (state.inventory.metal < cost) return fail('Insufficient metal for route');
  const capacity = state.buildings
    .filter((b) => b.health > 0)
    .reduce(
      (sum, b) => sum + (buildingDefinitions[b.type].capacity.metal ?? 0),
      0,
    );
  if (state.inventory.metal + refund > capacity + 1e-9)
    return fail('Insufficient warehouse space for refund');
  return {
    valid: true,
    reason: demolish ? 'Confirm demolition' : 'Confirm construction',
    cost,
    refund,
    tiles,
  };
}
