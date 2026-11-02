import { describe, expect, it } from 'vitest';
import {
  cancelProduction,
  capacities,
  colonySchema,
  construct,
  deploymentPoint,
  droneFleetLimits,
  emptyProduction,
  loadSave,
  productRegistrySchema,
  products,
  productsFor,
  queueProduct,
  selectProduct,
  step,
  toggleBuilding,
  type ColonyState,
} from '../../packages/simulation/src/index.js';
import { charged, run } from '../helpers/industry.js';
function factory() {
  return charged();
}
const stationId = 'built-1';
function order(s = factory(), product = 'survey-drone') {
  return queueProduct(s, stationId, product);
}
function blockEntries(s: ColonyState) {
  const b = s.buildings.find((b) => b.id === stationId)!;
  const positions = [
    { x: b.x, y: b.y - 1 },
    { x: b.x + 1, y: b.y },
    { x: b.x, y: b.y + 1 },
    { x: b.x - 1, y: b.y },
  ];
  return {
    ...s,
    residents: s.residents.map((r, i) =>
      i < positions.length
        ? { ...r, position: positions[i]!, route: [], waitTicks: 100 }
        : r,
    ),
  };
}
describe('validated products and reservations', () => {
  it('exposes implemented compatible products and rejects invalid registries/selections', () => {
    expect(productsFor('survey-station').map((p) => p.output.kind)).toEqual([
      'survey',
      'extractor',
    ]);
    expect(productsFor('warehouse')).toHaveLength(0);
    expect(() => queueProduct(factory(), 'starter-18', 'survey-drone')).toThrow(
      /incompatible/,
    );
    expect(() => selectProduct(factory(), stationId, 'cargo-drone')).toThrow(
      /incompatible/,
    );
    expect(
      productRegistrySchema.safeParse([...products, products[0]]).success,
    ).toBe(false);
    expect(
      productRegistrySchema.safeParse([{ ...products[0], duration: 0 }])
        .success,
    ).toBe(false);
  });
  it('reserves exact shared inputs once across competing queues without overspending', () => {
    let s = factory();
    s.inventory.metal = 30;
    const snapshot = JSON.stringify(s);
    s = order(s);
    expect(s.inventory.metal).toBe(15);
    s = order(s);
    expect(s.inventory.metal).toBe(0);
    expect(s.production.orders.map((o) => o.reserved.metal)).toEqual([15, 15]);
    expect(() => order(s)).toThrow(/Insufficient/);
    const original = JSON.parse(snapshot);
    expect(original.inventory.metal).toBe(30);
    expect(() => construct(s, 'housing', { x: 2, y: 9 })).toThrow(
      /Insufficient/,
    );
  });
  it('reserves queue and station fleet slots before any outputs complete', () => {
    let s = factory();
    s.inventory.metal = 300;
    for (let i = 0; i < 5; i++) s = order(s);
    expect(() => order(s)).toThrow(/queue full/);
    expect(s.industry.drones.length + s.production.orders.length).toBe(7);
    s = run(s, 80);
    expect(s.industry.drones.length).toBe(7);
    s = order(s);
    expect(s.industry.drones.length + s.production.orders.length).toBe(
      droneFleetLimits.station,
    );
    expect(() => order(s)).toThrow(/fleet capacity/);
  });
});
describe('powered deterministic assembly and deployment', () => {
  it('advances only paid work ticks, creates exactly one unique drone and never repeats completed output', () => {
    const s = order(),
      ticks = products[0]!.duration;
    const built = run(s, ticks);
    expect(built.industry.drones).toHaveLength(2);
    expect(built.production.orders[0]).toMatchObject({
      progress: ticks,
      status: 'awaiting-deployment',
    });
    const deployed = step(built);
    expect(deployed.production.orders).toHaveLength(0);
    const produced = deployed.industry.drones.find(
      (d) => d.id === 'produced-1',
    )!;
    expect(produced).toMatchObject({ stationId, kind: 'survey', job: null });
    expect(produced.battery).toBeGreaterThanOrEqual(0);
    expect(deployed.production.nextDroneId).toBe(2);
    expect(run(deployed, 40).industry.drones).toHaveLength(3);
    expect(s.production.orders[0]!.progress).toBe(0);
    expect(colonySchema.safeParse(deployed).success).toBe(true);
  });
  it('charges assembly electricity once in addition to station base load, without charging idle queues', () => {
    const base = factory();
    base.inventory.energy = 120;
    base.buildings.find((b) => b.type === 'battery')!.stores.energy = 120;
    const plain = step(base),
      producing = step(order(base));
    expect(producing.telemetry.used - plain.telemetry.used).toBeCloseTo(
      products[0]!.electricity,
    );
    expect(plain.inventory.energy - producing.inventory.energy).toBeCloseTo(
      products[0]!.electricity,
    );
  });
  it('pauses and resumes through power loss, disconnects, disable, damage and simulation pause', () => {
    const s = run(order(), 3),
      progress = s.production.orders[0]!.progress;
    expect(step({ ...s, speed: 0 })).toEqual({ ...s, speed: 0 });
    const disabled = toggleBuilding(s, stationId);
    expect(run(disabled, 3).production.orders[0]).toMatchObject({
      progress,
      blocked: 'disabled',
    });
    const restored = step(toggleBuilding(disabled, stationId));
    expect(restored.production.orders[0]!.progress).toBe(progress + 1);
    const off = structuredClone(s);
    off.buildings.find((b) => b.id === stationId)!.health = 0;
    expect(step(off).production.orders[0]).toMatchObject({
      progress,
      blocked: 'damaged',
    });
    const powerless = structuredClone(s);
    powerless.buildings.forEach((b) => {
      b.stores.energy = 0;
      if (b.type === 'solar') b.enabled = false;
    });
    powerless.inventory.energy = 0;
    expect(step(powerless).production.orders[0]).toMatchObject({
      progress,
      blocked: 'no-power',
    });
    const cut = { ...s, networks: [], infrastructure: [] };
    expect(step(cut).production.orders[0]).toMatchObject({
      progress,
      blocked: 'no-power-connection',
    });
  });
  it('holds a completed saved output if deployment becomes blocked and deploys once after recovery', () => {
    let s = run(order(), products[0]!.duration);
    s = blockEntries(s);
    expect(
      deploymentPoint(s, s.buildings.find((b) => b.id === stationId)!),
    ).toBeNull();
    const held = run(s, 3);
    expect(held.production.orders[0]).toMatchObject({
      status: 'awaiting-deployment',
      blocked: 'deployment-blocked',
    });
    expect(held.industry.drones).toHaveLength(2);
    const original = factory();
    const cleared = { ...held, residents: original.residents };
    const result = step(cleared);
    expect(result.production.orders).toHaveLength(0);
    expect(result.industry.drones).toHaveLength(3);
    expect(new Set(result.industry.drones.map((d) => d.id)).size).toBe(3);
  });
  it('creates supported extraction drones which can charge at their valid empty deployment entry', () => {
    let s = order(factory(), 'extraction-drone');
    s = run(s, products[1]!.duration + 1);
    const d = s.industry.drones.find((d) => d.id === 'produced-1')!;
    expect(d.kind).toBe('extractor');
    expect(
      s.buildings.some((b) => b.x === d.position.x && b.y === d.position.y),
    ).toBe(false);
    const next = run(s, 40).industry.drones.find((d) => d.id === 'produced-1')!;
    expect(next.battery).toBeGreaterThan(d.battery);
  });
});
describe('refunds and save conservation', () => {
  it('refunds exactly the saved reservation once and retains it if refund storage is full', () => {
    const base = factory(),
      s = run(order(base), 4),
      id = s.production.orders[0]!.id;
    const cancelled = cancelProduction(s, id);
    expect(cancelled.inventory.metal).toBe(base.inventory.metal);
    expect(() => cancelProduction(cancelled, id)).toThrow(/no longer exists/);
    const full = {
      ...s,
      inventory: { ...s.inventory, metal: capacities(s).metal },
    };
    const snapshot = JSON.stringify(full);
    expect(() => cancelProduction(full, id)).toThrow(/storage full/);
    expect(JSON.stringify(full)).toBe(snapshot);
    expect(
      cancelProduction(
        {
          ...full,
          inventory: { ...full.inventory, metal: full.inventory.metal - 15 },
        },
        id,
      ).inventory.metal,
    ).toBe(full.inventory.metal);
  });
  it('preserves mid-production and completed pending output on reload without replaying jobs or refunds', () => {
    for (const ticks of [5, products[0]!.duration]) {
      const s = run(order(order()), ticks),
        loaded = loadSave(JSON.parse(JSON.stringify(s)));
      expect(loaded.production).toEqual(s.production);
      expect(loaded.inventory).toEqual(s.inventory);
      expect(run(loaded, 40)).toEqual(run(s, 40));
    }
    const s = run(order(), 30),
      loaded = loadSave(JSON.parse(JSON.stringify(s)));
    expect(run(loaded, 30).industry.drones).toHaveLength(3);
    expect(() =>
      loadSave({ ...s, production: { ...s.production, nextDroneId: 1 } }),
    ).toThrow();
    const invalid = order();
    invalid.production.orders[0]!.reserved.metal++;
    expect(() => loadSave(invalid)).toThrow();
  });
  it('migrates actual schema-6 state without changing resources, drones, colony location or discoveries', () => {
    const current = factory();
    const { production: _p, ...old } = current;
    void _p;
    const loaded = loadSave({ ...old, schemaVersion: 6 });
    expect(loaded.production).toEqual(emptyProduction());
    expect(loaded.industry).toEqual(current.industry);
    expect(loaded.world).toEqual(current.world);
    expect(loaded.inventory).toEqual(current.inventory);
    expect(loaded.buildings).toEqual(current.buildings);
    expect(loaded.landingZone).toEqual(current.landingZone);
  });
});

it('reserves shared materials and generates unique outputs across simultaneous station queues', () => {
  let s = construct(factory(), 'survey-station', { x: 7, y: 3 });
  s.inventory.metal = 30;
  s = queueProduct(s, 'built-1', 'survey-drone');
  expect(() => queueProduct(s, 'built-2', 'extraction-drone')).toThrow(
    /Insufficient/,
  );
  s = queueProduct(s, 'built-2', 'survey-drone');
  expect(s.inventory.metal).toBe(0);
  s = run(s, 30);
  const outputs = s.industry.drones.filter((d) => d.id.startsWith('produced-'));
  expect(outputs.map((d) => d.id)).toEqual(['produced-1', 'produced-2']);
  expect(new Set(outputs.map((d) => d.stationId)).size).toBe(2);
  expect(colonySchema.safeParse(s).success).toBe(true);
});
it('holds work without spending assembly energy when the deployment area is already blocked', () => {
  const s = blockEntries(order());
  const next = step(s);
  expect(next.production.orders[0]).toMatchObject({
    progress: 0,
    blocked: 'deployment-blocked',
  });
  expect(next.inventory.metal).toBe(s.inventory.metal);
  const baseline = step(blockEntries(factory()));
  expect(next.telemetry.used).toBe(baseline.telemetry.used);
});

it('does not consume a partial assembly allocation when only residual grid energy is available', () => {
  const base = factory();
  base.tick = 180;
  base.inventory.energy = 1.75;
  base.buildings.find((b) => b.type === 'battery')!.stores.energy = 1.75;
  const baseline = step(base),
    next = step(order(base));
  expect(next.production.orders[0]).toMatchObject({
    progress: 0,
    blocked: 'no-power',
  });
  expect(next.telemetry.used).toBe(baseline.telemetry.used);
  expect(next.inventory.energy).toBe(baseline.inventory.energy);
});
it('lets a manufactured survey drone charge and complete an independent saved survey job', async () => {
  const { requestScan, discoveredDeposits } = await import(
    '../../packages/simulation/src/index.js'
  );
  let s = requestScan(
    factory(),
    stationId,
    'deep',
    { x: 32, y: 32 },
    { x: 47, y: 47 },
  );
  s = requestScan(
    s,
    stationId,
    'subsurface',
    { x: 21, y: 24 },
    { x: 21, y: 24 },
  );
  s = order(s);
  s = run(s, 150);
  expect(
    s.industry.drones.some((d) => d.id === 'produced-1' && d.kind === 'survey'),
  ).toBe(true);
  expect(s.industry.scans[0]!.status).toBe('active');
  expect(s.industry.scans[1]!.status).toBe('complete');
  expect(
    discoveredDeposits(s.world).some((d) => d.x === 21 && d.y === 24),
  ).toBe(true);
  expect(colonySchema.safeParse(s).success).toBe(true);
});
