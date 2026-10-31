import { z } from 'zod';
export const WORLD_SIZE = 20;
export const SOL_TICKS = 240;
export const resourceDefinitions = {
  water: { label: 'Water', unit: 'kg' },
  oxygen: { label: 'Oxygen', unit: 'kg' },
  food: { label: 'Food', unit: 'kg' },
  energy: { label: 'Energy', unit: 'kWh' },
  metal: { label: 'Metal', unit: 'kg' },
  wastewater: { label: 'Wastewater', unit: 'kg' },
  carbonDioxide: { label: 'Carbon dioxide', unit: 'kg' },
  nutrients: { label: 'Nutrients', unit: 'kg' },
} as const;
export const stockSchema = z
  .object({
    water: z.number().finite().nonnegative(),
    oxygen: z.number().finite().nonnegative(),
    food: z.number().finite().nonnegative(),
    energy: z.number().finite().nonnegative(),
    metal: z.number().finite().nonnegative(),
    wastewater: z.number().finite().nonnegative(),
    carbonDioxide: z.number().finite().nonnegative(),
    nutrients: z.number().finite().nonnegative(),
  })
  .strict();
export type Stock = z.infer<typeof stockSchema>;
export type Resource = keyof Stock;
export const resourceKeys = Object.keys(resourceDefinitions) as Resource[];
export const emptyStock = (): Stock => ({
  water: 0,
  oxygen: 0,
  food: 0,
  energy: 0,
  metal: 0,
  wastewater: 0,
  carbonDioxide: 0,
  nutrients: 0,
});
export type Category = 'Housing' | 'Life support' | 'Power' | 'Storage';
export const buildingTypeSchema = z.enum([
  'starship',
  'housing',
  'oxygen-generator',
  'oxygen-tank',
  'water-recycler',
  'water-tank',
  'farm',
  'solar',
  'battery',
  'warehouse',
]);
export type BuildingType = z.infer<typeof buildingTypeSchema>;
export type BuildingDefinition = {
  name: string;
  category: Category;
  width: number;
  height: number;
  color: number;
  power: number;
  generation: number;
  workers: number;
  priority: number;
  ports: Partial<
    Record<'water' | 'oxygen' | 'power', { x: number; y: number }>
  >;
  capacity: Partial<Stock>;
  housing: number;
  cost: { metal: number; credits: number };
  inputs: Partial<Stock>;
  outputs: Partial<Stock>;
};
function definition(
  value: Partial<BuildingDefinition> &
    Pick<BuildingDefinition, 'name' | 'category' | 'color'>,
): BuildingDefinition {
  return {
    width: 1,
    height: 1,
    power: 0,
    generation: 0,
    workers: 0,
    priority: 50,
    ports: {},
    capacity: {},
    housing: 0,
    cost: { metal: 10, credits: 5 },
    inputs: {},
    outputs: {},
    ...value,
  };
}
// Rates per fixed tick. Explicit feedstocks, not abstract free resource sources.
export const buildingDefinitions: Record<BuildingType, BuildingDefinition> = {
  starship: definition({
    name: 'Starship command centre',
    category: 'Housing',
    width: 2,
    height: 2,
    color: 0xd8dedb,
    power: 0.5,
    capacity: {
      water: 100,
      oxygen: 100,
      food: 60,
      metal: 80,
      wastewater: 60,
      carbonDioxide: 40,
      nutrients: 80,
    },
    cost: { metal: 0, credits: 0 },
  }),
  housing: definition({
    name: 'Modular housing',
    category: 'Housing',
    color: 0xb7b8ad,
    power: 0.05,
    housing: 1,
    cost: { metal: 8, credits: 5 },
  }),
  'oxygen-generator': definition({
    name: 'Oxygen generator',
    category: 'Life support',
    color: 0x73c7c6,
    power: 2,
    workers: 1,
    inputs: { water: 0.2 },
    outputs: { oxygen: 0.16 },
  }),
  'oxygen-tank': definition({
    name: 'Oxygen storage tank',
    category: 'Storage',
    color: 0x4eaaa9,
    capacity: { oxygen: 100 },
  }),
  'water-recycler': definition({
    name: 'Water recycling plant',
    category: 'Life support',
    color: 0x5fa5ce,
    power: 1,
    workers: 1,
    inputs: { wastewater: 0.1 },
    outputs: { water: 0.08 },
  }),
  'water-tank': definition({
    name: 'Water storage tank',
    category: 'Storage',
    color: 0x477bb4,
    capacity: { water: 100, wastewater: 140 },
  }),
  farm: definition({
    name: 'Hydroponic farm',
    category: 'Life support',
    width: 3,
    height: 2,
    color: 0x88b66c,
    power: 2,
    workers: 2,
    inputs: { water: 0.04, carbonDioxide: 0.03, nutrients: 0.01 },
    outputs: { food: 0.05, oxygen: 0.02 },
    capacity: { food: 60 },
  }),
  solar: definition({
    name: 'Solar power system',
    generation: 8,
    category: 'Power',
    width: 3,
    height: 2,
    color: 0x424d8e,
    cost: { metal: 15, credits: 8 },
  }),
  battery: definition({
    name: 'Energy storage system',
    category: 'Power',
    width: 2,
    color: 0xd69e4c,
    capacity: { energy: 240 },
    cost: { metal: 18, credits: 8 },
  }),
  warehouse: definition({
    name: 'Warehouse',
    category: 'Storage',
    width: 2,
    height: 2,
    color: 0x9d9383,
    capacity: { metal: 320, nutrients: 120, carbonDioxide: 160 },
  }),
};
export const landingCargo: Readonly<Stock> = Object.freeze({
  water: 100,
  oxygen: 100,
  food: 60,
  energy: 120,
  metal: 80,
  wastewater: 60,
  carbonDioxide: 40,
  nutrients: 80,
});
export const populationRates = {
  oxygen: 0.01,
  water: 0.008,
  food: 0.003,
} as const;
export const recipes = Object.entries(buildingDefinitions)
  .filter(([, value]) => Object.keys(value.inputs).length)
  .map(([id, value]) => ({ id, inputs: value.inputs, outputs: value.outputs }));
export const contractDefinitions: readonly never[] = [];

// One cardinal connection tile north of each footprint; channels can share that tile.
for (const [type, definition] of Object.entries(buildingDefinitions)) {
  if (definition.power || definition.generation || definition.capacity.energy)
    definition.ports.power = { x: 0, y: -1 };
  if (
    definition.housing ||
    definition.inputs.water ||
    definition.outputs.water ||
    definition.capacity.water
  )
    definition.ports.water = { x: 0, y: -1 };
  if (
    definition.housing ||
    definition.inputs.oxygen ||
    definition.outputs.oxygen ||
    definition.capacity.oxygen
  )
    definition.ports.oxygen = { x: 0, y: -1 };
  definition.priority =
    type === 'starship'
      ? 0
      : type === 'housing'
        ? 10
        : type === 'oxygen-generator'
          ? 20
          : type === 'water-recycler'
            ? 30
            : 50;
}
