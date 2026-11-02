import {
  newGame,
  findLandingZone,
} from '../../packages/simulation/src/index.js';
// Keep the original coordinate-based interaction regressions as legacy-save fixtures.
// Default central landings are tested independently against real API new-game creation.
export const legacyGame = (seed = 1) => newGame(seed, 'legacy');
export const legacyLandingZone = (seed: number) =>
  findLandingZone(seed, 'legacy');
