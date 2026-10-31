import console from 'node:console';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import {
  generateChunk,
  deployColony,
  newGame,
  revealArea,
  loadSave,
  step,
  construct,
  walkingPath,
} from '../packages/simulation/dist/index.js';
const results = {};
function measure(name, budget, fn) {
  const started = performance.now();
  const value = fn();
  const elapsed = performance.now() - started;
  results[name] = {
    milliseconds: Number(elapsed.toFixed(2)),
    budgetMilliseconds: budget,
  };
  if (elapsed > budget)
    throw new Error(`${name} exceeded ${budget}ms: ${elapsed}ms`);
  return value;
}
let tiles = 0;
measure('generateAll1024Chunks', 5000, () => {
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) tiles += generateChunk(73, x, y).length;
});
if (tiles !== 512 * 512) throw new Error('Incorrect world size');
let colony = deployColony(newGame(73));
colony.world = measure('exploreFullWorld', 5000, () =>
  revealArea(colony.world, colony.seed, { x: 0, y: 0 }, { x: 511, y: 511 }),
);
// A spread-out 100-building colony, still paid using original landing cargo.
// Cheap fixture buildings copy valid houses to exercise traversal/validation, not gameplay grants.
const template = colony.buildings.find((b) => b.type === 'housing');
colony.buildings.push(
  ...Array.from({ length: 81 }, (_, i) => ({
    ...template,
    id: `benchmark-${i}`,
    x: 40 + (i % 9) * 45,
    y: 40 + Math.floor(i / 9) * 45,
    stores: { ...template.stores },
  })),
);
measure('constructIn100BuildingColony', 5000, () =>
  construct(colony, 'housing', { x: 500, y: 500 }),
);
measure('1000Ticks100Buildings', 5000, () => {
  let state = colony;
  for (let i = 0; i < 1000; i++) state = step(state);
  return state;
});
const save = JSON.stringify(colony);
measure('fullWorld100BuildingSaveLoad', 5000, () => loadSave(JSON.parse(save)));
measure('1022StepUnobstructedPath', 1000, () =>
  walkingPath(
    { buildings: [], infrastructure: [] },
    { x: 0, y: 0 },
    { x: 511, y: 511 },
  ),
);
console.log(
  JSON.stringify(
    {
      logicalTiles: tiles,
      materialisedChunks: Object.keys(colony.world.chunks).length,
      buildings: colony.buildings.length,
      saveBytes: Buffer.byteLength(save),
      results,
    },
    null,
    2,
  ),
);
