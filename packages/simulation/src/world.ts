import { z } from 'zod';
import { WORLD_SIZE, CHUNK_SIZE, LEGACY_WORLD_SIZE } from './catalog.js';
import { hash, type Tile } from './terrain.js';
export const chunkKey = (x: number, y: number) => `${x},${y}`;
export const chunkOf = (tile: Tile): Tile => ({
  x: Math.floor(tile.x / CHUNK_SIZE),
  y: Math.floor(tile.y / CHUNK_SIZE),
});
export const mineralDefinitions = {
  iron: { name: 'Iron-bearing ore', technology: 'surface' },
  aluminium: { name: 'Aluminium-bearing ore', technology: 'surface' },
  copper: { name: 'Copper ore', technology: 'surface' },
  lithium: { name: 'Lithium-bearing ore', technology: 'underground' },
  silicon: { name: 'Silicon-bearing regolith', technology: 'surface' },
  carbon: { name: 'Carbon-bearing material', technology: 'surface' },
  titanium: { name: 'Titanium ore', technology: 'underground' },
  sulfur: { name: 'Sulfur-bearing material', technology: 'surface' },
  ice: { name: 'Water ice', technology: 'ice-drill' },
  uranium: { name: 'Uranium-bearing deposit', technology: 'deep' },
} as const;
export const mineralSchema = z.enum([
  'iron',
  'aluminium',
  'copper',
  'lithium',
  'silicon',
  'carbon',
  'titanium',
  'sulfur',
  'ice',
  'uranium',
]);
const coordinate = z
  .number()
  .int()
  .min(0)
  .max(WORLD_SIZE - 1);
export const depositSchema = z
  .object({
    id: z.string().min(1),
    resource: mineralSchema,
    x: coordinate,
    y: coordinate,
    classification: z.enum(['surface', 'subsurface']),
    depth: z.number().int().min(0).max(1000),
    richness: z.number().min(0.1).max(1),
    initialQuantity: z.number().finite().positive(),
    remainingQuantity: z.number().finite().nonnegative(),
    technology: z.enum(['surface', 'underground', 'ice-drill', 'deep']),
    discovered: z.boolean(),
  })
  .strict()
  .refine(
    (d) => d.remainingQuantity <= d.initialQuantity,
    'Remaining reserves exceed initial quantity',
  );
export type Deposit = z.infer<typeof depositSchema>;
const chunkSchema = z
  .object({
    x: z
      .number()
      .int()
      .min(0)
      .max(WORLD_SIZE / CHUNK_SIZE - 1),
    y: z
      .number()
      .int()
      .min(0)
      .max(WORLD_SIZE / CHUNK_SIZE - 1),
    explored: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(CHUNK_SIZE * CHUNK_SIZE - 1),
      )
      .max(CHUNK_SIZE * CHUNK_SIZE),
    deposits: z.array(depositSchema).max(20),
  })
  .strict();
export const worldSchema = z
  .object({
    version: z.literal(1),
    width: z.literal(WORLD_SIZE),
    height: z.literal(WORLD_SIZE),
    generatorVersion: z.literal(1),
    legacyTerrainSize: z.literal(LEGACY_WORLD_SIZE),
    chunks: z.record(z.string(), chunkSchema),
  })
  .strict()
  .superRefine((world, ctx) => {
    const ids = new Set<string>();
    for (const [key, chunk] of Object.entries(world.chunks)) {
      if (
        key !== chunkKey(chunk.x, chunk.y) ||
        new Set(chunk.explored).size !== chunk.explored.length
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid chunk identity or duplicate exploration',
        });
      for (const d of chunk.deposits) {
        const c = chunkOf(d);
        if (c.x !== chunk.x || c.y !== chunk.y || ids.has(d.id))
          ctx.addIssue({
            code: 'custom',
            message: 'Duplicate or misplaced deposit',
          });
        ids.add(d.id);
      }
    }
  });
export type WorldState = z.infer<typeof worldSchema>;
// The seed defines reserves everywhere before exploration. Materialise only accessed chunks.
// Scanning must reveal these records; it must not reroll or replenish them.
export function generateDeposits(
  seed: number,
  cx: number,
  cy: number,
): Deposit[] {
  const result: Deposit[] = [];
  const starter: z.infer<typeof mineralSchema>[] = [
    'iron',
    'aluminium',
    'copper',
    'lithium',
    'silicon',
    'carbon',
    'ice',
  ];
  const entries =
    cx === 1 && cy === 1
      ? starter
      : Array.from({ length: 3 }, (_, i) => {
          const h = hash(seed + i + 301, cx, cy);
          return h % 97 === 0
            ? ('uranium' as const)
            : mineralSchema.options[h % 9]!;
        });
  for (const [i, resource] of entries.entries()) {
    const h = hash(seed + 991 + i, cx, cy),
      technology = mineralDefinitions[resource].technology;
    const x = cx * CHUNK_SIZE + (cx === 1 && cy === 1 ? 5 + i : h % CHUNK_SIZE);
    const y =
      cy * CHUNK_SIZE + (cx === 1 && cy === 1 ? 8 : (h >>> 8) % CHUNK_SIZE);
    const subsurface = technology !== 'surface';
    result.push({
      id: `deposit-${cx}-${cy}-${i}`,
      resource,
      x,
      y,
      classification: subsurface ? 'subsurface' : 'surface',
      depth: subsurface ? 20 + (h % 481) : 0,
      richness: (4 + (h % 7)) / 10,
      initialQuantity: 1000 + (h % 4001),
      remainingQuantity: 1000 + (h % 4001),
      technology,
      discovered: false,
    });
  }
  return result;
}
export function newWorld(seed: number): WorldState {
  return revealArea(
    {
      version: 1,
      width: WORLD_SIZE,
      height: WORLD_SIZE,
      generatorVersion: 1,
      legacyTerrainSize: 20,
      chunks: {},
    },
    seed,
    { x: 0, y: 0 },
    { x: 19, y: 19 },
  );
}
export function isExplored(world: WorldState, tile: Tile): boolean {
  const c = chunkOf(tile),
    chunk = world.chunks[chunkKey(c.x, c.y)];
  return !!chunk?.explored.includes(
    (tile.y % CHUNK_SIZE) * CHUNK_SIZE + (tile.x % CHUNK_SIZE),
  );
}
// Called by exploration/scanning systems. Camera movement does not reveal terrain.
export function revealArea(
  world: WorldState,
  seed: number,
  from: Tile,
  to: Tile,
): WorldState {
  for (const p of [from, to])
    if (
      !Number.isInteger(p.x) ||
      !Number.isInteger(p.y) ||
      p.x < 0 ||
      p.y < 0 ||
      p.x >= WORLD_SIZE ||
      p.y >= WORLD_SIZE
    )
      throw new Error('Exploration outside world');
  const chunks = { ...world.chunks };
  for (
    let cy = Math.floor(Math.min(from.y, to.y) / CHUNK_SIZE);
    cy <= Math.floor(Math.max(from.y, to.y) / CHUNK_SIZE);
    cy++
  )
    for (
      let cx = Math.floor(Math.min(from.x, to.x) / CHUNK_SIZE);
      cx <= Math.floor(Math.max(from.x, to.x) / CHUNK_SIZE);
      cx++
    ) {
      const key = chunkKey(cx, cy),
        previous = chunks[key];
      const explored = new Set(previous?.explored ?? []);
      for (
        let y = Math.max(cy * CHUNK_SIZE, Math.min(from.y, to.y));
        y <= Math.min((cy + 1) * CHUNK_SIZE - 1, Math.max(from.y, to.y));
        y++
      )
        for (
          let x = Math.max(cx * CHUNK_SIZE, Math.min(from.x, to.x));
          x <= Math.min((cx + 1) * CHUNK_SIZE - 1, Math.max(from.x, to.x));
          x++
        )
          explored.add((y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE));
      chunks[key] = {
        x: cx,
        y: cy,
        explored: [...explored].sort((a, b) => a - b),
        deposits: previous?.deposits ?? generateDeposits(seed, cx, cy),
      };
    }
  return { ...world, chunks };
}
