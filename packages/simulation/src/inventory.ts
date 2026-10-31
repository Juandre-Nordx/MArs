import { z } from 'zod';
export const resourceIdSchema = z.enum(['water', 'oxygen', 'metal']);
export type ResourceId = z.infer<typeof resourceIdSchema>;
const amount = z.number().finite().nonnegative();
export const inventorySchema = z
  .object({ water: amount, oxygen: amount, metal: amount })
  .strict();
export type Inventory = z.infer<typeof inventorySchema>;
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
