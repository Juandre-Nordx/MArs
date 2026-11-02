import {
  buildInfrastructure,
  construct,
  deployColony,
  droneDefinitions,
  newGame,
  revealArea,
  scanTile,
  step,
  type ColonyState,
} from '../../packages/simulation/src/index.js';
export function station() {
  return construct(deployColony(newGame()), 'survey-station', { x: 8, y: 3 });
}
export function run(s: ColonyState, n: number) {
  for (let i = 0; i < n; i++) s = step(s);
  return s;
}
export function charged(s = station()) {
  // A prepared save fixture, separate from the tests that verify paid charging.
  s.industry.drones.forEach(
    (d) => (d.battery = droneDefinitions[d.kind].capacity),
  );
  return s;
}
export function mine() {
  let s = charged();
  const tile = { x: 21, y: 24 };
  s.world = revealArea(
    scanTile(s.world, s.seed, tile, 'surface'),
    s.seed,
    { x: 16, y: 16 },
    { x: 25, y: 25 },
  );
  s = construct(s, 'surface-mine', tile);
  s.world = revealArea(s.world, s.seed, { x: 0, y: 0 }, { x: 25, y: 25 });
  const clearRoute = [
    { x: 14, y: 4 },
    ...Array.from({ length: 9 }, (_, i) => ({ x: 15 + i, y: 4 })),
    ...Array.from({ length: 20 }, (_, i) => ({ x: 23, y: 5 + i })),
    { x: 22, y: 24 },
  ];
  s = buildInfrastructure(s, 'power', clearRoute);
  return s;
}
