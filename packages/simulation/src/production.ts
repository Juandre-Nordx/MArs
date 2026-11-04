import { runtimeCatalogue } from './catalogue.js';
import { z } from 'zod';
import {
  buildingTypeSchema,
  emptyStock,
  resourceKeys,
  stockSchema,
  type BuildingType,
} from './catalog.js';
import { capacities, type Building, type ColonyState } from './colony.js';
import { cells, connectionTiles, networkFor, tileKey } from './networks.js';
import { isExplored } from './world.js';
import { droneFleetLimits, type Drone } from './industry.js';

const productSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    icon: z.string().min(1),
    producers: z
      .array(buildingTypeSchema)
      .min(1)
      .refine(
        (types): boolean => types.every((type) => type === 'survey-station'),
        'Only implemented drone stations can produce these outputs',
      ),
    inputs: stockSchema.refine(
      (stock) => stock.water === 0 && stock.oxygen === 0 && stock.energy === 0,
      'Recipes reserve shared cargo only; utilities require a separate physical transfer system',
    ),
    duration: z.number().int().positive().max(100000),
    electricity: z.number().finite().positive(),
    workers: z.number().int().nonnegative(),
    prerequisites: z.array(z.string()).max(0),
    output: z
      .object({
        type: z.literal('drone'),
        kind: z.enum(['survey', 'extractor']),
        quantity: z.literal(1),
      })
      .strict(),
  })
  .strict();
export const productRegistrySchema = z
  .array(productSchema)
  .superRefine((products, ctx) => {
    if (new Set(products.map((p) => p.id)).size !== products.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate product ID' });
    for (const p of products)
      if (resourceKeys.every((k) => p.inputs[k] === 0))
        ctx.addIssue({
          code: 'custom',
          message: 'Product requires material inputs',
        });
  });
export type ProductDefinition = z.infer<typeof productRegistrySchema>[number];
export const products = productRegistrySchema.parse([
  {
    id: 'survey-drone',
    name: 'Survey drone',
    description:
      'An aerial geological survey drone. Starter-material recipe; deploys empty and charges from its home station.',
    icon: '◇',
    producers: ['survey-station'],
    inputs: { ...emptyStock(), metal: 15 },
    duration: 12,
    electricity: 1,
    workers: 0,
    prerequisites: [],
    output: { type: 'drone', kind: 'survey', quantity: 1 },
  },
  {
    id: 'extraction-drone',
    name: 'Extraction drone',
    description:
      'A ground drone for finite local-buffer mining. Cargo transport is not implemented. Deploys with an empty battery.',
    icon: '▣',
    producers: ['survey-station'],
    inputs: { ...emptyStock(), metal: 20 },
    duration: 18,
    electricity: 1,
    workers: 0,
    prerequisites: [],
    output: { type: 'drone', kind: 'extractor', quantity: 1 },
  },
]);
export const productionLimits = z
  .object({ queue: z.number().int().positive() })
  .parse({ queue: 5 });
export const productsFor = (type: BuildingType, state?: unknown) =>
  (state ? runtimeCatalogue(state).products : products).filter((p) =>
    p.producers.includes(type),
  );
export const productById = (id: string, state?: unknown) =>
  (state ? runtimeCatalogue(state).products : products).find(
    (p) => p.id === id,
  );
const counter = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const productionSchema = z
  .object({
    nextOrderId: counter,
    nextDroneId: counter,
    selections: z
      .array(
        z.object({ buildingId: z.string(), productId: z.string() }).strict(),
      )
      .max(400),
    orders: z
      .array(
        z
          .object({
            id: z.string(),
            buildingId: z.string(),
            productId: z.string(),
            reserved: stockSchema,
            progress: z.number().int().nonnegative(),
            status: z.enum(['queued', 'working', 'awaiting-deployment']),
            blocked: z.enum([
              'ready',
              'disabled',
              'damaged',
              'no-power-connection',
              'no-power',
              'no-workers',
              'deployment-blocked',
            ]),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();
export type Production = z.infer<typeof productionSchema>;
export type ProductionOrder = Production['orders'][number];
export const emptyProduction = (): Production => ({
  nextOrderId: 1,
  nextDroneId: 1,
  selections: [],
  orders: [],
});
export function selectProduct(
  state: ColonyState,
  buildingId: string,
  productId: string,
): ColonyState {
  const b = state.buildings.find((b) => b.id === buildingId),
    p = productById(productId, state);
  if (!b || !p || !p.producers.includes(b.type))
    throw new Error('Product is incompatible with this building');
  return {
    ...state,
    production: {
      ...state.production,
      selections: [
        ...state.production.selections.filter(
          (s) => s.buildingId !== buildingId,
        ),
        { buildingId, productId },
      ],
    },
  };
}
export function queueProduct(
  state: ColonyState,
  buildingId: string,
  productId: string,
): ColonyState {
  const selected = selectProduct(state, buildingId, productId),
    p = productById(productId, state)!;
  if (state.phase !== 'active') throw new Error('Wait for touchdown');
  const orders = state.production.orders;
  if (
    orders.filter((o) => o.buildingId === buildingId).length >=
    productionLimits.queue
  )
    throw new Error('Production queue full (5 orders)');
  if (
    state.industry.drones.filter((d) => d.stationId === buildingId).length +
      orders.filter((o) => o.buildingId === buildingId).length >=
    droneFleetLimits.station
  )
    throw new Error('Station fleet capacity reserved or full (8 drones)');
  if (state.industry.drones.length + orders.length >= droneFleetLimits.global)
    throw new Error('Colony fleet capacity reserved or full');
  if (resourceKeys.some((k) => state.inventory[k] < p.inputs[k]))
    throw new Error('Insufficient shared colony materials');
  if (state.production.nextOrderId === Number.MAX_SAFE_INTEGER)
    throw new Error('Order identity limit reached');
  const inventory = { ...state.inventory };
  for (const k of resourceKeys) inventory[k] -= p.inputs[k];
  const order: ProductionOrder = {
    id: `order-${state.production.nextOrderId}`,
    buildingId,
    productId,
    reserved: { ...p.inputs },
    progress: 0,
    status: 'queued',
    blocked: 'ready',
  };
  return {
    ...selected,
    inventory,
    production: {
      ...selected.production,
      nextOrderId: state.production.nextOrderId + 1,
      orders: [...orders, order],
    },
  };
}
export function cancelProduction(state: ColonyState, id: string): ColonyState {
  const order = state.production.orders.find((o) => o.id === id);
  if (!order) throw new Error('Order no longer exists; no refund issued');
  const cap = capacities(state);
  if (
    resourceKeys.some(
      (k) => state.inventory[k] + order.reserved[k] > cap[k] + 1e-9,
    )
  )
    throw new Error(
      'Refund storage full; order and reserved materials retained',
    );
  const inventory = { ...state.inventory };
  for (const k of resourceKeys) inventory[k] += order.reserved[k];
  return {
    ...state,
    inventory,
    production: {
      ...state.production,
      orders: state.production.orders.filter((o) => o.id !== id),
    },
  };
}
function deploymentOccupancy(state: ColonyState) {
  const occupied = new Set(
    state.buildings.flatMap((b) => cells(b).map(tileKey)),
  );
  for (const d of state.industry.drones) occupied.add(tileKey(d.position));
  for (const r of state.residents) occupied.add(tileKey(r.position));
  if (state.immigration.convoy)
    occupied.add(tileKey(state.immigration.convoy.position));
  return occupied;
}
export function deploymentPoint(
  state: ColonyState,
  b: Building,
  occupied = deploymentOccupancy(state),
) {
  return (
    connectionTiles(b, 'road').find(
      (t) => isExplored(state.world, t) && !occupied.has(tileKey(t)),
    ) ?? null
  );
}
export const productionReasons = {
  ready: 'Ready',
  disabled: 'Building disabled',
  damaged: 'Building damaged beyond operation',
  'no-power-connection': 'No electrical connection',
  'no-power': 'Insufficient electrical allocation',
  'no-workers': 'Required workers unavailable',
  'deployment-blocked': 'Deployment area blocked',
};
export function productionBlock(
  state: ColonyState,
  b: Building,
  order: ProductionOrder,
  occupied?: Set<string>,
): ProductionOrder['blocked'] {
  if (!b.enabled) return 'disabled';
  if (b.health <= 0) return 'damaged';
  if (!networkFor(state.networks, b.id, 'power')) return 'no-power-connection';
  if (b.workers < productById(order.productId, state)!.workers)
    return 'no-workers';
  if (b.status === 'no-power') return 'no-power';
  if (!deploymentPoint(state, b, occupied)) return 'deployment-blocked';
  return 'ready';
}
// One FIFO head per producer per tick. Assembly electricity is additional to the building's base load.
export function advanceProduction(
  state: ColonyState,
  drawExact: (id: string, energy: number) => boolean,
): void {
  if (!state.production.orders.length) return;
  state.production = structuredClone(state.production);
  const heads = new Map<string, ProductionOrder>();
  for (const o of state.production.orders)
    if (!heads.has(o.buildingId)) heads.set(o.buildingId, o);
  const buildings = new Map(state.buildings.map((b) => [b.id, b]));
  const done = new Set<string>();
  const occupied = deploymentOccupancy(state);
  for (const order of heads.values()) {
    const b = buildings.get(order.buildingId)!,
      p = productById(order.productId, state)!;
    order.blocked = productionBlock(state, b, order, occupied);
    if (order.blocked !== 'ready') continue;
    if (order.progress === p.duration) {
      const point = deploymentPoint(state, b, occupied)!;
      if (state.production.nextDroneId === Number.MAX_SAFE_INTEGER) {
        order.blocked = 'deployment-blocked';
        continue;
      }
      let next = state.production.nextDroneId;
      while (state.industry.drones.some((d) => d.id === `produced-${next}`))
        next++;
      const drone: Drone = {
        id: `produced-${next}`,
        stationId: b.id,
        kind: p.output.kind,
        position: { ...point },
        battery: 0,
        job: null,
        activity: 'charging',
      };
      // Copy before mutation: old simulation snapshots must remain immutable.
      state.industry = {
        ...state.industry,
        drones: [...state.industry.drones, drone],
      };
      occupied.add(tileKey(point));
      state.production.nextDroneId = next + 1;
      done.add(order.id);
      continue;
    }
    if (!drawExact(b.id, p.electricity)) {
      order.blocked = 'no-power';
      continue;
    }
    order.progress++;
    order.status =
      order.progress === p.duration ? 'awaiting-deployment' : 'working';
  }
  state.production.orders = state.production.orders.filter(
    (o) => !done.has(o.id),
  );
}
export function validateProduction(
  state: ColonyState,
  ctx: z.RefinementCtx,
): void {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const buildings = new Map(state.buildings.map((b) => [b.id, b]));
  if (
    new Set(state.production.orders.map((o) => o.id)).size !==
      state.production.orders.length ||
    new Set(state.production.selections.map((s) => s.buildingId)).size !==
      state.production.selections.length
  )
    issue('Duplicate production identity');
  for (const s of state.production.selections) {
    const b = buildings.get(s.buildingId),
      p = productById(s.productId, state);
    if (!b || !p || !p.producers.includes(b.type))
      issue('Invalid product selection');
  }
  for (const o of state.production.orders) {
    const b = buildings.get(o.buildingId),
      p = productById(o.productId, state);
    if (
      !b ||
      !p ||
      !p.producers.includes(b.type) ||
      !/^order-[1-9][0-9]*$/.test(o.id) ||
      Number(o.id.slice(6)) >= state.production.nextOrderId
    ) {
      issue('Invalid production order');
      continue;
    }
    if (
      o.progress > p.duration ||
      (o.status === 'awaiting-deployment') !== (o.progress === p.duration) ||
      resourceKeys.some((k) => o.reserved[k] !== p.inputs[k])
    )
      issue('Invalid production progress or reservation');
  }
  const counts = new Map<string, number>();
  for (const o of state.production.orders)
    counts.set(o.buildingId, (counts.get(o.buildingId) ?? 0) + 1);
  for (const [id, count] of counts)
    if (
      count > productionLimits.queue ||
      count + state.industry.drones.filter((d) => d.stationId === id).length >
        droneFleetLimits.station
    )
      issue('Production fleet or queue capacity exceeded');
  if (
    state.industry.drones.length + state.production.orders.length >
    droneFleetLimits.global
  )
    issue('Colony fleet capacity exceeded');
}
