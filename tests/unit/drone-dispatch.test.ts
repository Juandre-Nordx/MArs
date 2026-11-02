import { surveyFleet } from '../helpers/dispatch.js';
import { describe, expect, it } from 'vitest';
import {
  colonySchema,
  construct,
  loadSave,
  requestScan,
  step,
  type ColonyState,
} from '../../packages/simulation/src/index.js';
import { charged, run } from '../helpers/industry.js';
function plans(s = surveyFleet()) {
  s = requestScan(s, 'built-1', 'deep', { x: 21, y: 24 }, { x: 25, y: 25 });
  s = requestScan(s, 'built-1', 'surface', { x: 21, y: 24 }, { x: 25, y: 25 });
  return requestScan(
    s,
    'built-1',
    'surface',
    { x: 40, y: 40 },
    { x: 40, y: 40 },
  );
}
function exclusive(s: ColonyState) {
  const keys = s.industry.drones.flatMap((d) =>
    d.job ? [`${d.job.type}:${d.job.id}`] : [],
  );
  expect(new Set(keys).size).toBe(keys.length);
  expect(colonySchema.safeParse(s).success).toBe(true);
}
describe('one drone per job and survey area', () => {
  it('skips an overlapping waiting area and dispatches other drones to independent queues', () => {
    const s = step(plans());
    expect(s.industry.scans.map((q) => q.status)).toEqual([
      'active',
      'queued',
      'active',
    ]);
    expect(
      s.industry.drones
        .filter((d) => d.job?.type === 'scan')
        .map((d) => d.job!.id),
    ).toEqual(['scan-1', 'scan-3']);
    expect(
      s.industry.drones.filter((d) => !d.job && d.kind === 'survey'),
    ).toHaveLength(1);
    exclusive(s);
  });
  it('keeps exclusive ownership while returning and charging, then finishes pending overlapping work', () => {
    let s = step(plans());
    const owner = s.industry.drones.find((d) => d.job?.id === 'scan-1')!;
    owner.battery = 10;
    owner.activity = 'returning';
    const before = s.industry.scans[0]!.cursor;
    for (let i = 0; i < 12; i++) {
      s = step(s);
      exclusive(s);
      expect(s.industry.scans[1]!.status).toBe('queued');
    }
    expect(s.industry.scans[0]!.cursor).toBeGreaterThanOrEqual(before);
    for (
      let i = 0;
      i < 400 && s.industry.scans.some((q) => q.status !== 'complete');
      i++
    ) {
      s = step(s);
      exclusive(s);
    }
    expect(s.industry.scans.every((q) => q.status === 'complete')).toBe(true);
  });
  it('dispatches a finished survey drone directly to another affordable waiting job', () => {
    let s = charged();
    s = requestScan(
      s,
      'built-1',
      'surface',
      { x: 21, y: 24 },
      { x: 21, y: 24 },
    );
    s = requestScan(
      s,
      'built-1',
      'surface',
      { x: 22, y: 24 },
      { x: 22, y: 24 },
    );
    for (let i = 0; i < 100 && s.industry.scans[0]!.status !== 'complete'; i++)
      s = step(s);
    const position = { ...s.industry.drones[0]!.position };
    s = step(s);
    expect(s.industry.drones[0]!.job).toEqual({ type: 'scan', id: 'scan-2' });
    expect(s.industry.drones[0]!.position.x).toBeGreaterThanOrEqual(position.x);
    expect(s.industry.drones[0]!.activity).not.toBe('returning');
    exclusive(s);
  });
  it('reserves overlapping regions across stations and retains independent parallel work', () => {
    let s = charged(construct(charged(), 'survey-station', { x: 7, y: 3 }));
    s = requestScan(s, 'built-1', 'deep', { x: 21, y: 24 }, { x: 25, y: 25 });
    s = requestScan(
      s,
      'built-2',
      'subsurface',
      { x: 24, y: 25 },
      { x: 27, y: 25 },
    );
    s = requestScan(
      s,
      'built-2',
      'surface',
      { x: 40, y: 40 },
      { x: 40, y: 40 },
    );
    s = step(s);
    expect(s.industry.scans.map((q) => q.status)).toEqual([
      'active',
      'queued',
      'active',
    ]);
    exclusive(s);
  });
  it('requeues old overlapping active assignments on reload without resetting progress or reserves', () => {
    const old = plans();
    const surveyors = old.industry.drones.filter((d) => d.kind === 'survey');
    old.industry.scans[0]!.status = 'active';
    old.industry.scans[0]!.cursor = 1;
    old.industry.scans[1]!.status = 'active';
    old.industry.scans[1]!.cursor = 2;
    surveyors[0]!.job = { type: 'scan', id: 'scan-1' };
    surveyors[1]!.job = { type: 'scan', id: 'scan-2' };
    const loaded = loadSave(JSON.parse(JSON.stringify(old)));
    expect(loaded.industry.scans.map((q) => q.status)).toEqual([
      'active',
      'queued',
      'queued',
    ]);
    expect(loaded.industry.scans.map((q) => q.cursor)).toEqual(
      old.industry.scans.map((q) => q.cursor),
    );
    expect(loaded.world).toEqual(old.world);
    expect(loaded.inventory).toEqual(old.inventory);
    expect(
      loaded.industry.drones.find((d) => d.id === surveyors[1]!.id)!.job,
    ).toBeNull();
    exclusive(loaded);
    expect(run(loadSave(JSON.parse(JSON.stringify(loaded))), 10)).toEqual(
      run(loaded, 10),
    );
  });
});

it('skips an unaffordable distant queue for a later reachable queue, leaving distant work to a charged drone', () => {
  let s = surveyFleet();
  const first = s.industry.drones[0]!;
  first.position = { x: 21, y: 24 };
  first.battery = 20;
  s = requestScan(s, 'built-1', 'deep', { x: 60, y: 60 }, { x: 60, y: 60 });
  s = requestScan(s, 'built-1', 'surface', { x: 22, y: 24 }, { x: 22, y: 24 });
  s = step(s);
  expect(s.industry.drones[0]!.job).toEqual({ type: 'scan', id: 'scan-2' });
  expect(s.industry.drones.find((d) => d.id === 'produced-1')!.job).toEqual({
    type: 'scan',
    id: 'scan-1',
  });
  exclusive(s);
});
it('dispatches extraction drones to different mine queues with one owner each and exact reserve conservation', async () => {
  const {
    queueProduct,
    buildInfrastructure,
    revealArea,
    scanTile,
    discoveredDeposits,
  } = await import('../../packages/simulation/src/index.js');
  let s = queueProduct(charged(), 'built-1', 'extraction-drone');
  s = queueProduct(s, 'built-1', 'extraction-drone');
  s = run(s, 38);
  const home = s.industry.drones[0]!.position;
  for (const d of s.industry.drones) {
    d.battery = d.kind === 'survey' ? 128 : 64;
    d.job = null;
    d.activity = 'idle';
    d.position = { ...home };
  }
  s.world = revealArea(s.world, s.seed, { x: 0, y: 0 }, { x: 25, y: 25 });
  for (const x of [21, 22]) {
    s.world = scanTile(s.world, s.seed, { x, y: 24 }, 'surface');
    s = construct(s, 'surface-mine', { x, y: 24 });
  }
  s = buildInfrastructure(s, 'power', [
    { x: 14, y: 4 },
    ...Array.from({ length: 9 }, (_, i) => ({ x: 15 + i, y: 4 })),
    ...Array.from({ length: 19 }, (_, i) => ({ x: 23, y: 5 + i })),
    { x: 22, y: 23 },
    { x: 21, y: 23 },
  ]);
  s = step(s);
  expect(
    s.industry.drones.flatMap((d) =>
      d.job?.type === 'mine' ? [d.job.id] : [],
    ),
  ).toEqual(['built-2', 'built-3']);
  for (let i = 0; i < 130; i++) {
    s = step(s);
    exclusive(s);
  }
  for (const mine of s.industry.mines) {
    const d = discoveredDeposits(s.world).find((d) => d.id === mine.depositId)!;
    expect(mine.quantity).toBeGreaterThan(0);
    expect(d.remainingQuantity + mine.quantity).toBeCloseTo(
      d.initialQuantity,
      6,
    );
  }
});
