import { z } from 'zod';

export const buildingYaws = [0, 90, 180, 270] as const;
export const buildingYawSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type BuildingYaw = z.infer<typeof buildingYawSchema>;

export const modelStates = [
  'working',
  'idle',
  'construction',
  'damaged',
] as const;
const playback = {
  speed: z.number().finite().min(0.05).max(8),
  loop: z.boolean(),
};
const modelAnimationSchema = z.discriminatedUnion('method', [
  z
    .object({
      method: z.literal('clip'),
      clip: z.number().int().nonnegative().max(63),
      ...playback,
    })
    .strict(),
  z
    .object({
      method: z.literal('builtin'),
      effect: z.enum(['rotate', 'vertical', 'horizontal', 'pulse']),
      part: z.number().int().nonnegative().max(511).nullable(),
      axis: z.enum(['x', 'y', 'z']),
      direction: z.union([z.literal(1), z.literal(-1)]),
      distance: z.number().finite().min(0.01).max(5),
      ...playback,
    })
    .strict(),
]);
const position = z.number().finite().min(-10).max(10);
const angle = z.number().finite().min(-360).max(360);
export const buildingModelSchema = z
  .object({
    asset: z.string().uuid(),
    scale: z.number().finite().min(0.01).max(20),
    position: z.tuple([position, position, position]),
    rotation: z.tuple([angle, angle, angle]),
    ground: z.boolean(),
    animations: z
      .object({
        working: modelAnimationSchema.optional(),
        idle: modelAnimationSchema.optional(),
        construction: modelAnimationSchema.optional(),
        damaged: modelAnimationSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type BuildingModel = z.infer<typeof buildingModelSchema>;
export type ModelAnimation = z.infer<typeof modelAnimationSchema>;
export type ModelState = (typeof modelStates)[number];
export type ModelMetadata = {
  clips: { index: number; name: string }[];
  parts: { index: number; name: string }[];
};
export function defaultBuildingModel(asset: string): BuildingModel {
  return {
    asset,
    scale: 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    ground: true,
    animations: {},
  };
}
export function modelAnimationErrors(
  model: BuildingModel,
  metadata: ModelMetadata,
) {
  return modelStates.flatMap((state) => {
    const animation = model.animations[state];
    if (
      animation?.method === 'clip' &&
      !metadata.clips.some((clip) => clip.index === animation.clip)
    )
      return [
        `The ${state} animation refers to a clip missing from the model.`,
      ];
    if (
      animation?.method === 'builtin' &&
      animation.part !== null &&
      !metadata.parts.some((part) => part.index === animation.part)
    )
      return [
        `The ${state} animation refers to a part missing from the model.`,
      ];
    return [];
  });
}
