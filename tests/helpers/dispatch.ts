import {
  queueProduct,
  droneDefinitions,
} from '../../packages/simulation/src/index.js';
import { charged, run } from './industry.js';
export function surveyFleet() {
  let s = queueProduct(charged(), 'built-1', 'survey-drone');
  s = queueProduct(s, 'built-1', 'survey-drone');
  s = run(s, 26);
  const home = s.industry.drones[0]!.position;
  for (const d of s.industry.drones) {
    d.battery = droneDefinitions[d.kind].capacity;
    d.activity = 'idle';
    d.position = { ...home };
  }
  return s;
}
