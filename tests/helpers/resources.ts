import { legacyGame as newGame } from './landing.js';
import {
  deployColony,
  distributeCargo,
  refreshNetworks,
  type Stock,
} from '../../packages/simulation/src/index.js';
// Explicit partial reserves leave output room and isolate utility pools, independent of the full starting shipment.
export const productionCargo: Stock = {
  water: 100,
  oxygen: 100,
  food: 60,
  energy: 120,
  metal: 80,
  wastewater: 60,
  carbonDioxide: 40,
  nutrients: 80,
};
export function partiallyStockedColony(seed = 1) {
  const state = deployColony(newGame(seed));
  state.inventory = { ...productionCargo };
  distributeCargo(state);
  return refreshNetworks(state);
}
