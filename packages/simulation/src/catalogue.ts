import { z } from 'zod';
import {
  buildingDefinitions,
  buildingTypeSchema,
  resourceDefinitions,
  resourceKeys,
  emptyStock,
  type BuildingType,
  type BuildingDefinition,
  type Resource,
  type Category,
} from './catalog.js';
import { mineralDefinitions } from './world.js';
import { products, type ProductDefinition } from './production.js';
const id = z.string().regex(/^[a-z][A-Za-z0-9-]{0,63}$/);
const amount = z.number().finite().nonnegative().max(1000000);
export const units = {
  kg: 'mass',
  L: 'volume',
  items: 'count',
  kWh: 'energy',
  kW: 'power',
  MW: 'power',
} as const;
export const assetRefSchema = z
  .string()
  .refine(
    (s) =>
      s === 'placeholder:resource' ||
      s === 'placeholder:building' ||
      z.string().uuid().safeParse(s).success,
    'Invalid asset reference',
  );
const common = {
  id,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000),
  status: z.enum(['active', 'archived']),
  support: z.enum(['implemented', 'planned']),
  revision: z.number().int().positive(),
  icon: assetRefSchema,
};
export const resourceEntrySchema = z
  .object({
    ...common,
    category: z.enum([
      'raw-mineral',
      'refined-solid',
      'liquid',
      'gas',
      'energy',
      'manufactured',
    ]),
    baseValue: amount,
    unit: z.enum(['kg', 'L', 'items', 'kWh', 'kW', 'MW']),
  })
  .strict();
const quantity = z.object({ resourceId: id, quantity: amount }).strict();
export const electricitySchema = z
  .object({ quantity: amount, unit: z.enum(['kWh/tick', 'kW', 'MW']) })
  .strict();
export const buildingEntrySchema = z
  .object({
    ...common,
    category: z.string().min(1).max(60),
    sprite: assetRefSchema,
    scale: z.number().min(0.1).max(4),
    anchor: z
      .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
      .strict(),
    width: z.number().int().min(1).max(8),
    height: z.number().int().min(1).max(8),
    cost: z.array(quantity).max(32),
    creditCost: amount,
    electricity: electricitySchema,
    workers: z.number().int().nonnegative().max(1000),
    equipment: z.array(z.string()).max(0),
    utilities: z.array(z.enum(['water', 'oxygen', 'power'])).max(3),
    storage: z
      .array(
        z
          .object({
            resourceId: id,
            capacity: amount,
            scope: z.enum(['shared', 'utility']),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();
export const recipeEntrySchema = z
  .object({
    id,
    name: z.string().min(1).max(100),
    description: z.string().max(2000),
    revision: z.number().int().positive(),
    status: z.enum(['active', 'archived']),
    support: z.enum(['implemented', 'planned']),
    producerId: id,
    kind: z.enum(['continuous', 'drone', 'planned']),
    inputs: z.array(quantity).max(32),
    outputs: z.array(quantity).max(32),
    drone: z.enum(['survey', 'extractor']).nullable(),
    duration: z.number().int().positive().max(100000),
    electricity: electricitySchema,
    external: z.enum(['none', 'sunlight', 'planned']),
    workers: z.number().int().nonnegative().max(1000),
    equipment: z.array(z.string()).max(0),
  })
  .strict();
export const catalogueDocumentSchema = z
  .object({
    resources: z.array(resourceEntrySchema).max(300),
    buildings: z.array(buildingEntrySchema).max(200),
    recipes: z.array(recipeEntrySchema).max(500),
  })
  .strict();
export type CatalogueDocument = z.infer<typeof catalogueDocumentSchema>;
export type ResourceEntry = z.infer<typeof resourceEntrySchema>;
export type BuildingEntry = z.infer<typeof buildingEntrySchema>;
export type RecipeEntry = z.infer<typeof recipeEntrySchema>;
export function energyPerTick(e: z.infer<typeof electricitySchema>) {
  return e.unit === 'kWh/tick'
    ? e.quantity
    : (e.quantity * (e.unit === 'MW' ? 1000 : 1)) / 3600;
}
const coreResources = new Set([
  ...resourceKeys,
  ...Object.keys(mineralDefinitions),
]);
const continuousId = (type: string) => `${type}-continuous`;
function stock(list: z.infer<typeof quantity>[]) {
  const result = emptyStock();
  for (const item of list)
    if (resourceKeys.includes(item.resourceId as Resource))
      result[item.resourceId as Resource] = item.quantity;
  return result;
}
export function catalogueErrors(doc: CatalogueDocument): string[] {
  const errors: string[] = [];
  for (const group of ['resources', 'buildings', 'recipes'] as const)
    if (new Set(doc[group].map((d) => d.id)).size !== doc[group].length)
      errors.push(`Duplicate ${group} IDs`);
  const rs = new Map(doc.resources.map((r) => [r.id, r]));
  const bs = new Map(doc.buildings.map((b) => [b.id, b]));
  for (const r of doc.resources) {
    if (
      r.status === 'active' &&
      (r.support !== 'implemented' || !coreResources.has(r.id))
    )
      errors.push(
        `Resource ${r.id}: unsupported active resource; keep planned/archived`,
      );
    if (coreResources.has(r.id)) {
      const unit = r.id === 'energy' ? 'kWh' : 'kg';
      if (r.unit !== unit)
        errors.push(
          `Resource ${r.id}: unit conversion requires an explicit save migration (${unit} retained)`,
        );
      if (r.status !== 'active')
        errors.push(
          `Core resource ${r.id} is required by the current simulation`,
        );
    }
  }
  for (const key of coreResources)
    if (!rs.has(key)) errors.push(`Required resource missing: ${key}`);
  const validateQuantities = (
    list: { resourceId: string }[],
    owner: string,
  ) => {
    if (new Set(list.map((q) => q.resourceId)).size !== list.length)
      errors.push(`${owner}: duplicate resource references`);
    for (const q of list)
      if (!rs.has(q.resourceId))
        errors.push(`${owner}: unknown resource ${q.resourceId}`);
      else if (units[rs.get(q.resourceId)!.unit] === 'power')
        errors.push(
          `${owner}: power rates cannot be stored, consumed or reserved as quantities`,
        );
  };
  for (const b of doc.buildings) {
    validateQuantities(b.cost, b.id);
    validateQuantities(b.storage, b.id);
    if (b.status !== 'active') continue;
    if (
      b.support !== 'implemented' ||
      !buildingTypeSchema.safeParse(b.id).success
    ) {
      errors.push(`Building ${b.id}: unsupported active mechanic`);
      continue;
    }
    const base = buildingDefinitions[b.id as BuildingType];
    if (
      !['Housing', 'Life support', 'Power', 'Storage', 'Mining'].includes(
        b.category,
      )
    )
      errors.push(`Building ${b.id}: unsupported construction category`);
    if (b.width !== base.width || b.height !== base.height)
      errors.push(
        `Building ${b.id}: footprint changes require a supported starter-layout migration`,
      );
    if (
      [...b.utilities].sort().join() !== Object.keys(base.ports).sort().join()
    )
      errors.push(
        `Building ${b.id}: changing utility channels is unsupported; materials must remain isolated`,
      );
    if (b.cost.some((q) => q.resourceId !== 'metal'))
      errors.push(
        `Building ${b.id}: construction currently supports shared metal only`,
      );
    if (
      b.storage.some(
        (q) =>
          ['water', 'oxygen', 'energy'].includes(q.resourceId) &&
          !b.utilities.includes(
            q.resourceId === 'energy'
              ? 'power'
              : (q.resourceId as 'water' | 'oxygen'),
          ),
      )
    )
      errors.push(`Building ${b.id}: incompatible utility storage channel`);
    if (
      b.storage.some(
        (q) =>
          !resourceKeys.includes(q.resourceId as Resource) ||
          q.scope !==
            (['water', 'oxygen', 'energy'].includes(q.resourceId)
              ? 'utility'
              : 'shared'),
      )
    )
      errors.push(`Building ${b.id}: unsupported storage ownership/material`);
    if (energyPerTick(b.electricity) > 0 && !b.utilities.includes('power'))
      errors.push(
        `Building ${b.id}: operating demand requires its supported electrical connection`,
      );
  }
  for (const type of buildingTypeSchema.options) {
    const b = bs.get(type);
    if (!b) errors.push(`Required building missing: ${type}`);
    else if (
      ![
        'survey-station',
        'surface-mine',
        'underground-mine',
        'ice-drill',
        'deep-mine',
      ].includes(type) &&
      b.status !== 'active'
    )
      errors.push(`Starter building ${type} must remain active`);
  }
  const activeRecipes = doc.recipes.filter((r) => r.status === 'active');
  for (const r of doc.recipes) {
    validateQuantities(r.inputs, r.id);
    validateQuantities(r.outputs, r.id);
    if (!bs.has(r.producerId)) errors.push(`Recipe ${r.id}: unknown producer`);
    if (r.status !== 'active') continue;
    if (r.support !== 'implemented' || r.kind === 'planned') {
      errors.push(`Recipe ${r.id}: unsupported mechanic`);
      continue;
    }
    if (bs.get(r.producerId)?.status !== 'active')
      errors.push(`Recipe ${r.id}: inactive producer`);
    if (
      r.inputs.some((q) => q.quantity <= 0) ||
      r.outputs.some((q) => q.quantity <= 0)
    )
      errors.push(`Recipe ${r.id}: quantities must be positive`);
    if (
      r.inputs.some((q) => !resourceKeys.includes(q.resourceId as Resource)) ||
      r.outputs.some((q) => !resourceKeys.includes(q.resourceId as Resource))
    )
      errors.push(
        `Recipe ${r.id}: raw/local mineral transfers and refining are not implemented`,
      );
    if (r.kind === 'continuous') {
      const base = buildingDefinitions[r.producerId as BuildingType];
      if (
        !base ||
        r.id !== continuousId(r.producerId) ||
        r.duration !== 1 ||
        r.workers !== 0 ||
        r.drone !== null ||
        energyPerTick(r.electricity) !== 0
      ) {
        errors.push(
          `Recipe ${r.id}: unsupported continuous behavior or duplicate electricity charge`,
        );
        continue;
      }
      const inputKeys = Object.keys(base.inputs).sort().join(),
        outputKeys = base.generation
          ? 'energy'
          : Object.keys(base.outputs).sort().join();
      if (
        r.inputs
          .map((q) => q.resourceId)
          .sort()
          .join() !== inputKeys ||
        r.outputs
          .map((q) => q.resourceId)
          .sort()
          .join() !== outputKeys
      )
        errors.push(
          `Recipe ${r.id}: resource channels/conversions differ from supported behavior`,
        );
      if (base.generation) {
        if (r.external !== 'sunlight' || r.inputs.length)
          errors.push(`Recipe ${r.id}: solar requires explicit sunlight`);
      } else {
        if (r.external !== 'none' || !r.inputs.length)
          errors.push(`Recipe ${r.id}: production requires accounted inputs`);
        const total = (list: typeof r.inputs) =>
          list.reduce(
            (n, q) =>
              n + (rs.get(q.resourceId)?.unit === 'kg' ? q.quantity : 0),
            0,
          );
        if (total(r.outputs) > total(r.inputs) + 1e-9)
          errors.push(
            `Recipe ${r.id}: output mass exceeds accounted input mass`,
          );
      }
    } else {
      const base = products.find((p) => p.id === r.id);
      if (
        !base ||
        r.producerId !== 'survey-station' ||
        r.drone !== base.output.kind ||
        r.outputs.length ||
        r.inputs.length !== 1 ||
        r.inputs[0]?.resourceId !== 'metal' ||
        r.external !== 'none' ||
        energyPerTick(r.electricity) <= 0
      )
        errors.push(`Recipe ${r.id}: unsupported drone product/inputs`);
    }
  }
  for (const [type, b] of Object.entries(buildingDefinitions))
    if (
      (Object.keys(b.outputs).length || b.generation) &&
      !activeRecipes.some((r) => r.id === continuousId(type))
    )
      errors.push(`Required continuous recipe missing: ${type}`);
  if (
    activeRecipes
      .filter((r) => r.kind === 'continuous')
      .some(
        (r, i, all) =>
          all.findIndex((a) => a.producerId === r.producerId) !== i,
      )
  )
    errors.push('Multiple continuous recipes for one producer are unsupported');
  // Initial cargo must fit the fixed starter manifest (including ten habitats).
  for (const key of resourceKeys) {
    const capacity = buildingTypeSchema.options
      .filter(
        (t) =>
          ![
            'survey-station',
            'surface-mine',
            'underground-mine',
            'ice-drill',
            'deep-mine',
          ].includes(t),
      )
      .reduce(
        (n, t) =>
          n +
          (t === 'housing' ? 10 : 1) *
            (bs
              .get(t)
              ?.storage.filter((q) => q.resourceId === key)
              .reduce((x, q) => x + q.capacity, 0) ?? 0),
        0,
      );
    const minimum = {
      water: 200,
      oxygen: 200,
      food: 120,
      energy: 240,
      metal: 160,
      wastewater: 120,
      carbonDioxide: 80,
      nutrients: 160,
    }[key];
    if (capacity < minimum)
      errors.push(
        `Starter ${key} capacity must retain its ${minimum} shipment`,
      );
  }
  return errors;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export const catalogueSnapshotSchema = z
  .object({ id: z.string().min(1).max(100), document: catalogueDocumentSchema })
  .strict()
  .superRefine((s, ctx) => {
    for (const message of catalogueErrors(s.document))
      ctx.addIssue({ code: 'custom', message });
  })
  .transform(freeze);
export type CatalogueSnapshot = z.infer<typeof catalogueSnapshotSchema>;
let builtin: CatalogueSnapshot | undefined;
export function builtinCatalogue(): CatalogueSnapshot {
  if (builtin) return builtin;
  const resources: CatalogueDocument['resources'] = resourceKeys.map((key) => ({
    id: key,
    name: resourceDefinitions[key].label,
    description: `Existing shared or physical colony ${key} reserve. Base price is metadata; trading is not implemented.`,
    icon: 'placeholder:resource',
    category:
      key === 'energy'
        ? 'energy'
        : ['water', 'wastewater'].includes(key)
          ? 'liquid'
          : ['oxygen', 'carbonDioxide'].includes(key)
            ? 'gas'
            : 'refined-solid',
    baseValue: 0,
    unit: key === 'energy' ? 'kWh' : 'kg',
    status: 'active',
    support: 'implemented',
    revision: 1,
  }));
  // Permanent IDs preserve the existing camel-case carbonDioxide key.
  for (const [key, d] of Object.entries(mineralDefinitions))
    resources.push({
      id: key,
      name: d.name,
      description: `Finite ${d.technology} deposit; raw output stays in local mine buffers.`,
      icon: 'placeholder:resource',
      category: 'raw-mineral',
      baseValue: 0,
      unit: 'kg',
      status: 'active',
      support: 'implemented',
      revision: 1,
    });
  const buildings: CatalogueDocument['buildings'] =
    buildingTypeSchema.options.map((type) => {
      const b = buildingDefinitions[type];
      return {
        id: type,
        name: b.name,
        description: `Existing ${b.category.toLowerCase()} facility using supported ${type} behavior.`,
        category: b.category,
        icon: 'placeholder:building',
        sprite: 'placeholder:building',
        scale: 1,
        anchor: { x: 0.5, y: 1 },
        width: b.width,
        height: b.height,
        cost: b.cost.metal
          ? [{ resourceId: 'metal', quantity: b.cost.metal }]
          : [],
        creditCost: b.cost.credits,
        electricity: { quantity: b.power, unit: 'kWh/tick' },
        workers: b.workers,
        equipment: [],
        utilities: Object.keys(b.ports) as ('water' | 'oxygen' | 'power')[],
        storage: Object.entries(b.capacity).map(([resourceId, capacity]) => ({
          resourceId,
          capacity,
          scope: ['water', 'oxygen', 'energy'].includes(resourceId)
            ? 'utility'
            : 'shared',
        })),
        status: 'active',
        support: 'implemented',
        revision: 1,
      };
    });
  const recipes: CatalogueDocument['recipes'] = Object.entries(
    buildingDefinitions,
  )
    .filter(([, b]) => Object.keys(b.outputs).length || b.generation)
    .map(([type, b]) => ({
      id: continuousId(type),
      name: `${b.name} cycle`,
      description:
        'Existing fixed-tick operation; electricity is included in the building base demand.',
      revision: 1,
      status: 'active',
      support: 'implemented',
      producerId: type,
      kind: 'continuous',
      inputs: Object.entries(b.inputs).map(([resourceId, quantity]) => ({
        resourceId,
        quantity,
      })),
      outputs: b.generation
        ? [{ resourceId: 'energy', quantity: b.generation }]
        : Object.entries(b.outputs).map(([resourceId, quantity]) => ({
            resourceId,
            quantity,
          })),
      drone: null,
      duration: 1,
      electricity: { quantity: 0, unit: 'kWh/tick' },
      external: b.generation ? 'sunlight' : 'none',
      workers: 0,
      equipment: [],
    }));
  for (const p of products)
    recipes.push({
      id: p.id,
      name: p.name,
      description: p.description,
      revision: 1,
      status: 'active',
      support: 'implemented',
      producerId: 'survey-station',
      kind: 'drone',
      inputs: resourceKeys
        .filter((k) => p.inputs[k] > 0)
        .map((resourceId) => ({ resourceId, quantity: p.inputs[resourceId] })),
      outputs: [],
      drone: p.output.kind,
      duration: p.duration,
      electricity: { quantity: p.electricity, unit: 'kWh/tick' },
      external: 'none',
      workers: p.workers,
      equipment: [],
    });
  return (builtin = catalogueSnapshotSchema.parse({
    id: 'builtin-v0331',
    document: { resources, buildings, recipes },
  }));
}
const cache = new WeakMap<
  CatalogueSnapshot,
  {
    buildings: Record<BuildingType, BuildingDefinition>;
    products: ProductDefinition[];
  }
>();
export function runtimeCatalogue(state?: unknown) {
  const snapshot = (state as { catalogue?: CatalogueSnapshot } | undefined)
    ?.catalogue;
  if (!snapshot) return { buildings: buildingDefinitions, products };
  const previous = cache.get(snapshot);
  if (previous) return previous;
  const buildings = { ...buildingDefinitions };
  for (const entry of snapshot.document.buildings) {
    if (!buildingTypeSchema.safeParse(entry.id).success) continue;
    const type = entry.id as BuildingType,
      base = buildingDefinitions[type];
    const recipe = snapshot.document.recipes.find(
      (r) =>
        r.status === 'active' &&
        r.kind === 'continuous' &&
        r.producerId === type,
    );
    buildings[type] = {
      ...base,
      name: entry.name,
      category: entry.category as Category,
      cost: {
        metal: entry.cost.find((q) => q.resourceId === 'metal')?.quantity ?? 0,
        credits: entry.creditCost,
      },
      power: energyPerTick(entry.electricity),
      workers: entry.workers,
      capacity: Object.fromEntries(
        entry.storage.map((q) => [q.resourceId, q.capacity]),
      ),
      inputs: recipe ? stock(recipe.inputs) : base.inputs,
      outputs:
        recipe && !base.generation ? stock(recipe.outputs) : base.outputs,
      generation:
        recipe && base.generation
          ? recipe.outputs[0]!.quantity
          : base.generation,
    };
  }
  const paid = products.flatMap((base) => {
    const recipe = snapshot.document.recipes.find(
      (r) => r.status === 'active' && r.id === base.id,
    );
    return recipe
      ? [
          {
            ...base,
            name: recipe.name,
            description: recipe.description,
            inputs: stock(recipe.inputs),
            duration: recipe.duration,
            electricity: energyPerTick(recipe.electricity),
            workers: recipe.workers,
          },
        ]
      : [];
  });
  const result = freeze({ buildings, products: paid });
  cache.set(snapshot, result);
  return result;
}
export function buildingAvailable(
  state: { catalogue?: CatalogueSnapshot },
  type: string,
) {
  return (
    !state.catalogue ||
    state.catalogue.document.buildings.some(
      (b) =>
        b.id === type && b.status === 'active' && b.support === 'implemented',
    )
  );
}
