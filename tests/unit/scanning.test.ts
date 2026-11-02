import { describe, expect, it } from 'vitest';
import {
  canDetect,
  discoveredDeposits,
  generateDeposits,
  isExplored,
  newWorld,
  scanTile,
  revealArea,
  type Deposit,
} from '../../packages/simulation/src/index.js';
describe('geological detection', () => {
  it('uses depth limits for all three configured modes', () => {
    const base = generateDeposits(1, 1, 1)[0]!;
    for (const [depth, expected] of [
      [0, [true, true, true]],
      [20, [false, true, true]],
      [250, [false, true, true]],
      [251, [false, false, true]],
      [1000, [false, false, true]],
    ] as const) {
      const d: Deposit = { ...base, depth };
      expect(
        ['surface', 'subsurface', 'deep'].map((m) =>
          canDetect(d, m as 'surface' | 'subsurface' | 'deep'),
        ),
      ).toEqual(expected);
    }
  });
  it('reveals only seed-defined deposits at visited tiles and never reveals terrain implicitly', () => {
    const w = newWorld(1),
      d = generateDeposits(1, 1, 1)[0]!;
    expect(discoveredDeposits(w)).toHaveLength(0);
    const scanned = scanTile(w, 1, { x: d.x, y: d.y }, 'surface');
    expect(discoveredDeposits(scanned)).toEqual([{ ...d, discovered: true }]);
    expect(isExplored(scanned, d)).toBe(false);
    expect(discoveredDeposits(w)).toHaveLength(0);
    expect(discoveredDeposits(revealArea(w, 1, d, d))).toHaveLength(0);
  });
  it('repeated scanning and exploration preserve depleted reserves exactly', () => {
    const d = generateDeposits(1, 1, 1)[0]!;
    let w = scanTile(newWorld(1), 1, { x: d.x, y: d.y }, 'deep');
    w.chunks['1,1']!.deposits[0]!.remainingQuantity = 0;
    for (let i = 0; i < 8; i++)
      w = scanTile(revealArea(w, 1, d, d), 1, { x: d.x, y: d.y }, 'deep');
    expect(w.chunks['1,1']!.deposits[0]!.remainingQuantity).toBe(0);
    expect(w.chunks['1,1']!.deposits).toHaveLength(7);
  });
});
