import { describe, expect, it } from 'vitest';
import {
  builtinCatalogue,
  catalogueErrors,
  catalogueDocumentSchema,
  catalogueSnapshotSchema,
  energyPerTick,
  newGame,
  deployColony,
  loadSave,
  step,
  construct,
  capacities,
  runtimeCatalogue,
  productsFor,
  queueProduct,
  type CatalogueDocument,
} from '@mars/simulation';
import { charged, run } from '../helpers/industry.js';
const document = () => structuredClone(builtinCatalogue().document);
const snapshot = (doc: CatalogueDocument) =>
  catalogueSnapshotSchema.parse({ id: 'published-100', document: doc });
describe('catalogue capabilities and physical dimensions', () => {
  it('seeds the real registry with unchanged costs, rates, units and placeholder art', () => {
    const original = runtimeCatalogue(),
      derived = runtimeCatalogue(newGame());
    for (const [key, b] of Object.entries(original.buildings)) {
      const actual = derived.buildings[key as keyof typeof original.buildings];
      expect(actual.cost).toEqual(b.cost);
      expect(actual.capacity).toEqual(b.capacity);
      expect(actual.power).toBe(b.power);
      for (const [r, n] of Object.entries(b.inputs))
        expect(actual.inputs[r as keyof typeof b.inputs]).toBe(n);
    }
    expect(derived.products).toEqual(original.products);
    expect(catalogueErrors(document())).toEqual([]);
    expect(
      document().resources.every((r) => r.icon === 'placeholder:resource'),
    ).toBe(true);
  });
  it('keeps power rates separate from stored energy without silent quantity conversions', () => {
    expect(energyPerTick({ quantity: 3600, unit: 'kW' })).toBe(1);
    expect(energyPerTick({ quantity: 3.6, unit: 'MW' })).toBe(1);
    const doc = document();
    doc.resources[0]!.unit = 'L';
    expect(catalogueErrors(doc).join()).toMatch(/explicit save migration/);
    doc.resources[0]!.unit = 'MW';
    expect(catalogueErrors(doc).join()).toMatch(/power rates cannot be stored/);
  });
  it('rejects duplicates, unknown references, invalid quantities and unsupported active content', () => {
    const doc = document();
    doc.resources.push(doc.resources[0]!);
    expect(catalogueErrors(doc)).toContain('Duplicate resources IDs');
    doc.recipes[0]!.inputs = [{ resourceId: 'unknown', quantity: 1 }];
    expect(catalogueErrors(doc).join()).toMatch(/unknown resource/);
    doc.buildings[0]!.creditCost = -1;
    expect(catalogueDocumentSchema.safeParse(doc).success).toBe(false);
  });
  it('allows explicitly planned archived content but blocks activating unsupported mechanics', () => {
    const doc = document();
    doc.resources.push({
      ...doc.resources[0]!,
      id: 'planned-alloy',
      name: 'Future alloy',
      status: 'archived',
      support: 'planned',
    });
    doc.buildings.push({
      ...doc.buildings[0]!,
      id: 'planned-smelter',
      name: 'Future smelter',
      status: 'archived',
      support: 'planned',
    });
    doc.recipes.push({
      ...doc.recipes[0]!,
      id: 'future-smelting',
      producerId: 'planned-smelter',
      status: 'archived',
      support: 'planned',
      kind: 'planned',
    });
    expect(catalogueErrors(doc)).toEqual([]);
    doc.recipes.at(-1)!.status = 'active';
    expect(catalogueErrors(doc).join()).toMatch(/unsupported mechanic/);
    doc.buildings.at(-1)!.status = 'active';
    expect(catalogueErrors(doc).join()).toMatch(/unsupported active mechanic/);
  });
  it('requires accounted production inputs, mass conservation and explicit solar sunlight', () => {
    const doc = document();
    const r = doc.recipes.find((r) => r.producerId === 'oxygen-generator')!;
    r.outputs[0]!.quantity = 1000;
    expect(catalogueErrors(doc).join()).toMatch(/output mass exceeds/);
    r.inputs = [];
    expect(catalogueErrors(doc).join()).toMatch(/requires accounted inputs/);
    doc.recipes.find((r) => r.producerId === 'solar')!.external = 'none';
    expect(catalogueErrors(doc).join()).toMatch(/explicit sunlight/);
  });
  it('blocks incompatible utility channels, geometry changes and double-charged continuous power', () => {
    const doc = document();
    doc.buildings
      .find((b) => b.id === 'water-tank')!
      .storage.push({ resourceId: 'oxygen', capacity: 30, scope: 'utility' });
    expect(catalogueErrors(doc).join()).toMatch(/incompatible utility storage/);
    doc.buildings[0]!.width = 8;
    doc.recipes[0]!.electricity.quantity = 1;
    expect(catalogueErrors(doc).join()).toMatch(/footprint changes/);
    expect(catalogueErrors(doc).join()).toMatch(/duplicate electricity charge/);
  });
  it('rejects a starter capacity reduction that would destroy initial cargo', () => {
    const doc = document();
    for (const b of doc.buildings)
      b.storage = b.storage.filter((q) => q.resourceId !== 'water');
    expect(catalogueErrors(doc).join()).toMatch(/Starter water capacity/);
  });
});
describe('immutable snapshots and save compatibility', () => {
  it('uses changed costs, capacities, solar and life-support recipes only in the selected snapshot', () => {
    const doc = document();
    doc.buildings.find((b) => b.id === 'housing')!.cost = [
      { resourceId: 'metal', quantity: 1 },
    ];
    doc.buildings.find((b) => b.id === 'housing')!.creditCost = 2;
    doc.buildings
      .find((b) => b.id === 'warehouse')!
      .storage.find((q) => q.resourceId === 'metal')!.capacity += 100;
    const solar = doc.recipes.find((r) => r.producerId === 'solar')!;
    solar.outputs[0]!.quantity *= 2;
    const oxygen = doc.recipes.find(
      (r) => r.producerId === 'oxygen-generator',
    )!;
    for (const q of [...oxygen.inputs, ...oxygen.outputs]) q.quantity *= 2;
    const old = deployColony(newGame(1, 'legacy')),
      edited = deployColony(newGame(1, 'legacy', snapshot(doc)));
    for (const s of [old, edited]) {
      for (const b of s.buildings) b.stores.oxygen /= 2;
      s.inventory.oxygen /= 2;
    }
    expect(capacities(edited).metal).toBe(capacities(old).metal + 100);
    expect(step(edited).telemetry.generated).toBe(
      step(old).telemetry.generated * 2,
    );
    expect(step(edited).telemetry.produced.oxygen).toBeGreaterThan(
      step(old).telemetry.produced.oxygen,
    );
    const made = construct(edited, 'housing', { x: 2, y: 9 });
    expect(made.inventory.metal).toBe(edited.inventory.metal - 1);
    expect(made.credits).toBe(edited.credits - 2);
    expect(runtimeCatalogue(old).buildings.housing.cost).not.toEqual(
      runtimeCatalogue(edited).buildings.housing.cost,
    );
    expect(Object.isFrozen(edited.catalogue.document.buildings)).toBe(true);
    const loaded = loadSave(JSON.parse(JSON.stringify(edited)));
    expect(loaded.inventory).toEqual(edited.inventory);
    expect(loaded.buildings).toEqual(edited.buildings);
    expect(loaded.catalogue).toEqual(edited.catalogue);
    expect(loadSave(loaded)).toEqual(loaded);
    expect(run(loadSave(JSON.parse(JSON.stringify(old))), 10)).toEqual(
      run(old, 10),
    );
  });
  it('runs paid production from its pinned materials, duration and additional power', () => {
    const doc = document();
    const recipe = doc.recipes.find((r) => r.id === 'survey-drone')!;
    recipe.inputs[0]!.quantity = 7;
    recipe.duration = 2;
    recipe.electricity.quantity = 0.1;
    recipe.workers = 0;
    const old = charged(),
      edited = { ...charged(), catalogue: snapshot(doc) };
    expect(productsFor('survey-station', edited)[0]!.duration).toBe(2);
    const order = queueProduct(edited, 'built-1', 'survey-drone');
    expect(order.inventory.metal).toBe(edited.inventory.metal - 7);
    expect(run(order, 5).industry.drones).toHaveLength(3);
    expect(productsFor('survey-station', old)[0]!.duration).not.toBe(2);
  });
  it('migrates actual schema 7 without altering production, discoveries, population or resources', () => {
    const s = run(queueProduct(charged(), 'built-1', 'survey-drone'), 3);
    const { catalogue: _catalogue, ...old } = JSON.parse(JSON.stringify(s));
    void _catalogue;
    const migrated = loadSave({ ...old, schemaVersion: 7 });
    for (const key of [
      'production',
      'industry',
      'world',
      'buildings',
      'inventory',
      'residents',
      'population',
      'landingZone',
      'infrastructure',
    ] as const)
      expect(migrated[key]).toEqual(s[key]);
    expect(migrated.catalogue).toEqual(builtinCatalogue());
    expect(run(migrated, 5)).toEqual(run(s, 5));
    expect(loadSave(migrated)).toEqual(migrated);
  });
  it('rejects missing or incompatible pinned catalogues instead of substituting current definitions', () => {
    const s = newGame();
    expect(() => loadSave({ ...s, catalogue: undefined })).toThrow(
      /Required catalogue snapshot/,
    );
    const doc = document();
    doc.resources[0]!.unit = 'L';
    expect(() =>
      loadSave({ ...s, catalogue: { id: 'published-2', document: doc } }),
    ).toThrow(/unit conversion/);
  });
});
