import { buildingDefinitions, populationRates, SOL_TICKS } from './catalog.js';
import { isUsable, networkFor, reserve, type Network } from './networks.js';
import { hash } from './terrain.js';
import { RESERVE_TICKS } from './people.js';
import type { ColonyState } from './colony.js';
export type CitizenComment = {
  code: string;
  title: string;
  quote: string;
  evidence: string;
  action: string | null;
  severity: 'positive' | 'advice' | 'warning' | 'critical';
};
export type ResidentFeedback = {
  residentId: string;
  name: string;
  mood: 'Content' | 'Concerned' | 'Distressed';
  headline: string;
  happyAbout: CitizenComment[];
  concerns: CitizenComment[];
  cityNeeds: CitizenComment[];
};
const amount = (value: number) => value.toFixed(2);
function utilityDemand(
  state: ColonyState,
  n: Network,
  type: 'water' | 'oxygen',
) {
  const people = state.residents.filter(
    (r) => r.homeId && n.buildings.includes(r.homeId),
  ).length;
  return (
    people * populationRates[type] +
    state.buildings
      .filter((b) => isUsable(b) && n.buildings.includes(b.id))
      .reduce(
        (sum, b) => sum + (buildingDefinitions[b.type].inputs[type] ?? 0),
        0,
      )
  );
}
// Read-only assessment of current conditions. No invented happiness meter or history.
export function residentFeedback(
  state: ColonyState,
  residentId: string,
): ResidentFeedback | null {
  const resident = state.residents.find((r) => r.id === residentId);
  if (!resident || state.phase !== 'active') return null;
  const number = Number(resident.id.slice(9));
  const voice = hash(state.seed, number, 3) % 2;
  const happyAbout: CitizenComment[] = [],
    concerns: CitizenComment[] = [],
    cityNeeds: CitizenComment[] = [];
  const add = (
    list: CitizenComment[],
    code: string,
    title: string,
    quote: string,
    evidence: string,
    action: string | null,
    severity: CitizenComment['severity'],
  ) => list.push({ code, title, quote, evidence, action, severity });
  const home = state.buildings.find((b) => b.id === resident.homeId),
    homeUsable = home && isUsable(home);
  if (!homeUsable)
    add(
      concerns,
      'home-unavailable',
      'Working home needed',
      home
        ? 'My home is out of service. I need somewhere safe to live.'
        : 'I do not have a home assigned to me.',
      'No operational assigned habitat',
      'Provide an enabled, healthy housing unit.',
      'critical',
    );
  else {
    add(
      happyAbout,
      'home',
      'A home of my own',
      voice
        ? 'Having my own place makes this settlement feel like home.'
        : 'I have a proper place to sleep. That means a lot out here.',
      `${buildingDefinitions[home.type].name} · ${home.id}`,
      null,
      'positive',
    );
    for (const type of ['oxygen', 'water'] as const) {
      const n = networkFor(state.networks, home.id, type),
        supply = n ? reserve(state, n) : 0,
        need = n ? utilityDemand(state, n, type) * RESERVE_TICKS : 0;
      if (!n)
        add(
          concerns,
          `${type}-connection`,
          `No ${type} connection`,
          `My habitat has no ${type} connection. Please reconnect it.`,
          `Home ${home.id} is outside the ${type} network`,
          type === 'water'
            ? 'Place a water pipe directly beside any side of the home and link it to supply.'
            : "Connect the home's north-side oxygen port to a supplied network.",
          'critical',
        );
      else if (supply <= 1e-9)
        add(
          concerns,
          `${type}-empty`,
          `${type === 'water' ? 'Water' : 'Oxygen'} supply empty`,
          `There is no ${type} left in the stores my home can use.`,
          `${n.id}: ${amount(supply)} kg available`,
          `Check connected ${type === 'water' ? 'water tanks, recycling inputs and power' : 'oxygen tanks, generator water inputs and power'}.`,
          'critical',
        );
      else if (supply + 1e-9 < need)
        add(
          concerns,
          `${type}-low`,
          `${type === 'water' ? 'Water' : 'Oxygen'} reserves running low`,
          `We have some ${type}, but our connected reserves are getting thin.`,
          `${amount(supply)} kg available here; ${amount(need)} kg covers ${RESERVE_TICKS} ticks of current demand`,
          `Increase connected ${type} supply and inspect producer inputs and storage.`,
          'warning',
        );
      else
        add(
          happyAbout,
          type,
          `Reliable ${type}`,
          type === 'water'
            ? voice
              ? 'It is a relief to have water connected to my home.'
              : 'Our water reserves give me some peace of mind.'
            : voice
              ? 'The oxygen supply at home is something I can count on.'
              : 'I am glad my home has a good oxygen supply.',
          `${n.id}: ${amount(supply)} kg available`,
          null,
          'positive',
        );
    }
    const grid = networkFor(state.networks, home.id, 'power');
    const solar =
      grid && state.tick % SOL_TICKS < SOL_TICKS * 0.75
        ? state.buildings
            .filter((b) => grid.producers.includes(b.id) && isUsable(b))
            .reduce((sum, b) => sum + buildingDefinitions[b.type].generation, 0)
        : 0;
    if (
      !grid ||
      home.status === 'no-power' ||
      home.status === 'no-power-connection' ||
      solar + (grid ? reserve(state, grid) : 0) + 1e-9 <
        buildingDefinitions[home.type].power
    )
      add(
        concerns,
        'home-power',
        'Power at home needed',
        'My habitat needs a working power supply.',
        grid
          ? `${grid.id} cannot supply this home`
          : 'No electrical connection at this home',
        'Check the north-side cable port, connected solar arrays and battery charge.',
        'warning',
      );
    else
      add(
        happyAbout,
        'power',
        'Power at home',
        'I am glad my habitat has access to electricity.',
        grid.id,
        null,
        'positive',
      );
  }
  const foodNeed = state.population * populationRates.food * RESERVE_TICKS;
  if (state.inventory.food <= 1e-9)
    add(
      concerns,
      'food-empty',
      'Food stores empty',
      'We need food in storage. Please check the farm.',
      `${amount(state.inventory.food)} kg food in colony stores`,
      'Check hydroponic farm power, water, carbon dioxide, nutrients and output storage.',
      'critical',
    );
  else if (state.inventory.food + 1e-9 < foodNeed)
    add(
      concerns,
      'food-low',
      'Food reserves running low',
      'Our food supply needs attention before the stores run out.',
      `${amount(state.inventory.food)} kg stored; ${amount(foodNeed)} kg covers ${RESERVE_TICKS} ticks`,
      'Keep a supplied, powered hydroponic farm operating.',
      'warning',
    );
  else
    add(
      happyAbout,
      'food',
      'Food in the stores',
      voice
        ? 'Seeing food in the stores makes life here feel more secure.'
        : 'There is food put aside for us. That is good to know.',
      `${amount(state.inventory.food)} kg stored for ${state.population} residents`,
      null,
      'positive',
    );
  if (resident.activity === 'waiting')
    add(
      concerns,
      'route',
      'A clear path needed',
      'I cannot find a useful route for this trip.',
      `Current activity: ${resident.activity}`,
      'Keep terrain approaches between building entrances clear.',
      'warning',
    );
  else if (resident.activity === 'walking' && resident.route.length > 0)
    add(
      happyAbout,
      'paths',
      'Getting around',
      'It is good to be able to get between the buildings.',
      `Activity: ${resident.activity}; trips planned: ${resident.trips}`,
      null,
      'positive',
    );
  // Settlement advice is separate from the resident's personal outlook.
  for (const type of ['water', 'oxygen', 'power'] as const) {
    const disconnected = state.residents.filter((r) => {
      const h = state.buildings.find((b) => b.id === r.homeId);
      return !h || !isUsable(h) || !networkFor(state.networks, h.id, type);
    }).length;
    if (disconnected)
      add(
        cityNeeds,
        `city-${type}-connections`,
        `Restore ${type} connections`,
        `Some of our neighbors do not have a working ${type} connection.`,
        `${disconnected} resident(s) affected`,
        `Inspect homes and repair the missing ${type === 'power' ? 'cable' : 'pipe'} routes.`,
        'critical',
      );
  }
  for (const type of ['water', 'oxygen'] as const) {
    const low = state.networks.filter(
      (n) =>
        n.type === type &&
        utilityDemand(state, n, type) > 0 &&
        reserve(state, n) + 1e-9 <
          utilityDemand(state, n, type) * RESERVE_TICKS,
    );
    if (low.length)
      add(
        cityNeeds,
        `city-${type}-reserves`,
        `Build up ${type} reserves`,
        `The colony needs stronger ${type} reserves in its occupied networks.`,
        `${low.length} network(s) below ${RESERVE_TICKS} ticks of nominal demand`,
        `Inspect ${type} production inputs, storage and connections.`,
        'warning',
      );
  }
  if (state.inventory.food + 1e-9 < foodNeed || state.inventory.food <= 1e-9)
    add(
      cityNeeds,
      'city-food',
      'Rebuild food reserves',
      'The colony needs more food set aside.',
      `${amount(state.inventory.food)} / ${amount(foodNeed)} kg safety reserve`,
      'Check the hydroponic farm and its supply chains.',
      state.inventory.food <= 1e-9 ? 'critical' : 'warning',
    );
  const unpowered = state.buildings.filter(
    (b) =>
      isUsable(b) &&
      (b.status === 'no-power' || b.status === 'no-power-connection'),
  );
  if (unpowered.length)
    add(
      cityNeeds,
      'city-power',
      'Restore power',
      'Some facilities are going without power.',
      `${unpowered.length} building(s) report a power fault`,
      'Reconnect grids or add connected solar generation and battery reserves.',
      'warning',
    );
  const blocked = state.buildings.filter(
    (b) => isUsable(b) && b.status === 'no-input',
  );
  if (blocked.length)
    add(
      cityNeeds,
      'city-inputs',
      'Supply stalled facilities',
      'Some machines are waiting for their ingredients.',
      `${blocked.length} building(s) report missing inputs`,
      'Inspect those facilities and restore their required feedstocks.',
      'warning',
    );
  const beds = state.buildings
    .filter(isUsable)
    .reduce((sum, b) => sum + buildingDefinitions[b.type].housing, 0);
  if (beds < state.population)
    add(
      cityNeeds,
      'city-housing-shortage',
      'House every resident',
      'We need enough working homes for everyone.',
      `${beds} beds for ${state.population} residents`,
      'Construct or enable supplied housing.',
      'critical',
    );
  else if (beds === state.population)
    add(
      cityNeeds,
      'city-housing-growth',
      'Room for new neighbors',
      'If we want more neighbors, another supplied home would help.',
      `${beds} beds, all occupied`,
      'Build a home and connect water, oxygen and power.',
      'advice',
    );
  const rank = { critical: 0, warning: 1, advice: 2, positive: 3 };
  concerns.sort((a, b) => rank[a.severity] - rank[b.severity]);
  cityNeeds.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const mood = concerns.some((c) => c.severity === 'critical')
    ? 'Distressed'
    : concerns.length
      ? 'Concerned'
      : 'Content';
  return {
    residentId,
    name: `Colonist ${number}`,
    mood,
    headline:
      concerns[0]?.quote ??
      happyAbout[voice % Math.max(1, happyAbout.length)]?.quote ??
      'I am taking stock of life in the colony.',
    happyAbout,
    concerns,
    cityNeeds,
  };
}
