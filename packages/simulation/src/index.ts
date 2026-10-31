import { z } from 'zod';
export const SCHEMA_VERSION = 1 as const;
export const STEP_MS = 1000;
export const resourceDefinitions = {
  water: { label: 'Water', unit: 'kg' },
  oxygen: { label: 'Oxygen', unit: 'kg' },
  metal: { label: 'Metal', unit: 'kg' },
} as const;
export const resourceIdSchema = z.enum(['water', 'oxygen', 'metal']);
export type ResourceId = z.infer<typeof resourceIdSchema>;
const amount = z.number().finite().nonnegative();
export const inventorySchema = z
  .object({ water: amount, oxygen: amount, metal: amount })
  .strict();
export type Inventory = z.infer<typeof inventorySchema>;
export const colonySchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    seed: z.number().int().nonnegative(),
    tick: z.number().int().nonnegative(),
    name: z.string().min(1).max(64),
    inventory: inventorySchema,
  })
  .strict();
export type ColonyState = z.infer<typeof colonySchema>;
// Scenario manifest: an explicit starting cargo allocation, not ongoing production.
export const landingCargo: Readonly<Inventory> = Object.freeze({
  water: 100,
  oxygen: 100,
  metal: 80,
});
export const buildingDefinitions = [
  { id: 'landing-pod', label: 'Landing pod', width: 1, height: 1 },
] as const;
export const recipeSchema = z
  .object({
    id: z.string().min(1),
    inputs: inventorySchema,
    outputs: inventorySchema,
  })
  .strict()
  .refine(
    (recipe) => Object.values(recipe.inputs).some((value) => value > 0),
    'Recipes require inputs',
  );
export type Recipe = z.infer<typeof recipeSchema>;
export const recipes: readonly Recipe[] = []; // Production arrives in a later stage.
export const contractDefinitions: readonly {
  id: string;
  delivery: Inventory;
  rewardCredits: number;
}[] = [];
export function newGame(seed = 1): ColonyState {
  return colonySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    seed,
    tick: 0,
    name: 'First Colony',
    inventory: { ...landingCargo },
  });
}
export function step(state: ColonyState): ColonyState {
  return colonySchema.parse({ ...state, tick: state.tick + 1 });
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
  const total = clock.remainderMs + elapsedMs;
  const ticks = Math.floor(total / STEP_MS);
  if (!Number.isSafeInteger(clock.colony.tick + ticks))
    throw new Error('Clock overflow');
  return {
    colony: colonySchema.parse({
      ...clock.colony,
      tick: clock.colony.tick + ticks,
    }),
    remainderMs: total % STEP_MS,
  };
}
export function transfer(
  source: Inventory,
  target: Inventory,
  cargo: Inventory,
): { source: Inventory; target: Inventory } {
  inventorySchema.parse(source);
  inventorySchema.parse(target);
  inventorySchema.parse(cargo);
  const nextSource = { ...source };
  const nextTarget = { ...target };
  for (const key of resourceIdSchema.options) {
    if (source[key] < cargo[key]) throw new Error(`Insufficient ${key}`);
    nextSource[key] -= cargo[key];
    nextTarget[key] += cargo[key];
  }
  return {
    source: inventorySchema.parse(nextSource),
    target: inventorySchema.parse(nextTarget),
  };
}
export function applyRecipe(inventory: Inventory, input: Recipe): Inventory {
  const recipe = recipeSchema.parse(input);
  inventorySchema.parse(inventory);
  const next = { ...inventory };
  for (const key of resourceIdSchema.options) {
    if (inventory[key] < recipe.inputs[key])
      throw new Error(`Insufficient ${key}`);
    next[key] = inventory[key] - recipe.inputs[key] + recipe.outputs[key];
  }
  return inventorySchema.parse(next);
}
export function loadSave(value: unknown): ColonyState {
  return colonySchema.parse(value);
}
