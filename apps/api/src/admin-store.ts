import { Prisma, type PrismaClient } from '@prisma/client';
import {
  builtinCatalogue,
  catalogueDocumentSchema,
  catalogueErrors,
  resourceEntrySchema,
  buildingEntrySchema,
  recipeEntrySchema,
  type CatalogueDocument,
} from '@mars/simulation';
import { createHash } from 'node:crypto';
export class AdminError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const assetIds = (doc: CatalogueDocument) => [
  ...new Set(
    [
      ...doc.resources.map((r) => r.icon),
      ...doc.buildings.flatMap((b) => [b.icon, b.sprite]),
    ].filter((id) => !id.startsWith('placeholder:')),
  ),
];
async function indexDraft(
  tx: Prisma.TransactionClient,
  doc: CatalogueDocument,
) {
  for (const r of doc.resources)
    await tx.resourceDefinition.upsert({
      where: { id: r.id },
      create: { id: r.id, revision: r.revision, document: json(r) },
      update: { revision: r.revision, document: json(r) },
    });
  for (const b of doc.buildings)
    await tx.buildingDefinition.upsert({
      where: { id: b.id },
      create: { id: b.id, revision: b.revision, document: json(b) },
      update: { revision: b.revision, document: json(b) },
    });
  for (const r of doc.recipes) {
    await tx.recipeDefinition.upsert({
      where: { id: r.id },
      create: {
        id: r.id,
        producerId: r.producerId,
        revision: r.revision,
        document: json(r),
      },
      update: {
        producerId: r.producerId,
        revision: r.revision,
        document: json(r),
      },
    });
    await tx.recipeReference.deleteMany({ where: { recipeId: r.id } });
    for (const direction of ['inputs', 'outputs'] as const)
      for (const q of r[direction])
        await tx.recipeReference.create({
          data: { recipeId: r.id, resourceId: q.resourceId, direction },
        });
  }
}
export async function seedCatalogue(db: PrismaClient, actorId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(440041)::text`;
    const existing = await tx.catalogueDraft.findUnique({
      where: { id: 'main' },
    });
    if (existing) return existing;
    const doc = builtinCatalogue().document;
    await indexDraft(tx, doc);
    await tx.catalogueState.upsert({
      where: { id: 'main' },
      create: { id: 'main' },
      update: {},
    });
    const draft = await tx.catalogueDraft.create({
      data: { id: 'main', document: json(doc) },
    });
    await tx.adminAudit.create({
      data: {
        actorId,
        action: 'catalogue.seed',
        detail: { revision: draft.revision },
      },
    });
    return draft;
  });
}
export async function updateDraft(
  db: PrismaClient,
  actorId: string,
  revision: number,
  kind: 'resources' | 'buildings' | 'recipes',
  entry: unknown,
  create: boolean,
) {
  const schema = {
    resources: resourceEntrySchema,
    buildings: buildingEntrySchema,
    recipes: recipeEntrySchema,
  }[kind];
  const value = schema.parse(entry);
  return db.$transaction(async (tx) => {
    const old = await tx.catalogueDraft.findUnique({ where: { id: 'main' } });
    if (!old) throw new AdminError(409, 'Initialise the catalogue draft first');
    if (old.revision !== revision)
      throw new AdminError(409, 'Draft changed; reload before editing');
    const doc = catalogueDocumentSchema.parse(old.document);
    const index = doc[kind].findIndex((e) => e.id === value.id);
    if (create && index >= 0)
      throw new AdminError(409, 'Permanent ID already exists');
    if (!create && index < 0)
      throw new AdminError(404, 'Entry not found; IDs cannot be renamed');
    const previous = index >= 0 ? doc[kind][index] : undefined;
    const next = { ...value, revision: (previous?.revision ?? 0) + 1 };
    // Validate references even for planned draft entries, so normalised DB references remain sound.
    const merged = {
      ...doc,
      [kind]:
        index < 0
          ? [...doc[kind], next]
          : doc[kind].map((e, i) => (i === index ? next : e)),
    };
    const parsed = catalogueDocumentSchema.parse(merged);
    const resources = new Set(parsed.resources.map((r) => r.id)),
      buildings = new Set(parsed.buildings.map((b) => b.id));
    for (const r of parsed.recipes)
      if (
        !buildings.has(r.producerId) ||
        [...r.inputs, ...r.outputs].some((q) => !resources.has(q.resourceId))
      )
        throw new AdminError(
          422,
          'Recipe has an unknown resource or producer reference',
        );
    const updated = await tx.catalogueDraft.updateMany({
      where: { id: 'main', revision },
      data: { document: json(parsed), revision: { increment: 1 } },
    });
    if (updated.count !== 1)
      throw new AdminError(409, 'Concurrent edit; reload the draft');
    await indexDraft(tx, {
      resources: parsed.resources.filter(
        (e) => kind === 'resources' && e.id === value.id,
      ),
      buildings: parsed.buildings.filter(
        (e) => kind === 'buildings' && e.id === value.id,
      ),
      recipes: parsed.recipes.filter(
        (e) => kind === 'recipes' && e.id === value.id,
      ),
    });
    await tx.adminAudit.create({
      data: {
        actorId,
        action: `draft.${create ? 'create' : 'edit'}`,
        detail: json({
          kind,
          id: value.id,
          fromRevision: previous?.revision ?? null,
          toRevision: next.revision,
        }),
      },
    });
    return tx.catalogueDraft.findUniqueOrThrow({ where: { id: 'main' } });
  });
}
export async function draftErrors(
  db: Pick<Prisma.TransactionClient, 'catalogueAsset'>,
  doc: CatalogueDocument,
) {
  const errors = catalogueErrors(doc);
  const references = [
    ...doc.resources.map((r) => ({ ref: r.icon, slot: 'resource-icon' })),
    ...doc.buildings.flatMap((b) => [
      { ref: b.icon, slot: 'building-icon' },
      { ref: b.sprite, slot: 'building-sprite' },
    ]),
  ];
  const assets = await db.catalogueAsset.findMany({
    where: {
      id: {
        in: [
          ...new Set(
            references
              .filter((r) => !r.ref.startsWith('placeholder:'))
              .map((r) => r.ref),
          ),
        ],
      },
    },
    select: { id: true, slot: true },
  });
  for (const r of references) {
    if (r.ref.startsWith('placeholder:')) {
      if (
        r.ref !==
        (r.slot === 'resource-icon'
          ? 'placeholder:resource'
          : 'placeholder:building')
      )
        errors.push(`Wrong placeholder for ${r.slot}`);
      continue;
    }
    const asset = assets.find((a) => a.id === r.ref);
    if (!asset || asset.slot !== r.slot)
      errors.push(`Missing or incompatible ${r.slot}: ${r.ref}`);
  }
  return errors;
}
export async function publishDraft(
  db: PrismaClient,
  actorId: string,
  revision: number,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(440041)::text`;
    const draft = await tx.catalogueDraft.findUnique({ where: { id: 'main' } });
    const current = await tx.catalogueState.findUnique({
      where: { id: 'main' },
    });
    if (
      !draft ||
      draft.revision !== revision ||
      draft.baseVersion !== (current?.currentVersion ?? null)
    )
      throw new AdminError(
        409,
        'Draft/current version changed; reload before publishing',
      );
    const doc = catalogueDocumentSchema.parse(draft.document);
    const errors = await draftErrors(tx, doc);
    if (errors.length) throw new AdminError(422, errors.join('\n'));
    const claim = await tx.catalogueDraft.updateMany({
      where: { id: 'main', revision },
      data: { revision: { increment: 1 } },
    });
    if (claim.count !== 1) throw new AdminError(409, 'Concurrent draft edit');
    const digest = createHash('sha256')
      .update(JSON.stringify(doc))
      .digest('hex');
    const version = await tx.publishedCatalogue.create({
      data: { document: json(doc), digest, actorId },
    });
    for (const assetId of assetIds(doc))
      await tx.publishedAsset.create({
        data: { versionId: version.id, assetId },
      });
    await tx.catalogueState.update({
      where: { id: 'main' },
      data: { currentVersion: version.id },
    });
    await tx.catalogueDraft.update({
      where: { id: 'main' },
      data: { baseVersion: version.id },
    });
    await tx.adminAudit.create({
      data: {
        actorId,
        action: 'catalogue.publish',
        detail: { version: version.id, digest, revision },
      },
    });
    return version;
  });
}
export function draftDiff(before: CatalogueDocument, after: CatalogueDocument) {
  return (['resources', 'buildings', 'recipes'] as const).flatMap((kind) =>
    after[kind].flatMap((entry) => {
      const old = before[kind].find((e) => e.id === entry.id);
      return JSON.stringify(old) === JSON.stringify(entry)
        ? []
        : [{ kind, id: entry.id, before: old ?? null, after: entry }];
    }),
  );
}
