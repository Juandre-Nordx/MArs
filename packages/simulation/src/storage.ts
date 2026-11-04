import { runtimeCatalogue } from './catalogue.js';
import { resourceKeys, type Resource } from './catalog.js';
import { capacities, type ColonyState } from './colony.js';
import { droneDefinitions, extractionDefinitions, isMine } from './industry.js';
import { mineralDefinitions } from './world.js';
export function storageOverview(state: ColonyState) {
  const buildingDefinitions = runtimeCatalogue(state).buildings;
  const cap = capacities(state);
  const resources = resourceKeys.map((resource) => ({
    resource,
    quantity: state.inventory[resource],
    capacity: cap[resource],
    scope: (['water', 'oxygen', 'energy'] as Resource[]).includes(resource)
      ? ('physical' as const)
      : ('shared' as const),
    warning:
      state.inventory[resource] >= cap[resource] - 1e-6
        ? 'Full'
        : state.inventory[resource] <= cap[resource] * 0.2
          ? 'Low stock'
          : '',
    // These buildings contribute capacity; shared cargo is not assigned fictitious ownership.
    capacityBuildings: state.buildings
      .filter((b) => (buildingDefinitions[b.type].capacity[resource] ?? 0) > 0)
      .map((b) => b.id),
  }));
  const utilityStores = state.buildings.flatMap((b) =>
    (['water', 'oxygen', 'energy'] as const)
      .filter(
        (resource) => (buildingDefinitions[b.type].capacity[resource] ?? 0) > 0,
      )
      .map((resource) => ({
        buildingId: b.id,
        resource,
        quantity: b.stores[resource],
        capacity: buildingDefinitions[b.type].capacity[resource]!,
        enabled: b.enabled,
        health: b.health,
      })),
  );
  const deposits = new Map(
    Object.values(state.world.chunks).flatMap((c) =>
      c.deposits.map((d) => [d.id, d] as const),
    ),
  );
  const buildings = new Map(state.buildings.map((b) => [b.id, b]));
  const mines = state.industry.mines.map((m) => {
    const b = buildings.get(m.buildingId)!;
    const deposit = deposits.get(m.depositId)!;
    return {
      buildingId: b.id,
      resource: deposit.resource,
      label: mineralDefinitions[deposit.resource].name,
      quantity: m.quantity,
      capacity: isMine(b.type) ? extractionDefinitions[b.type].capacity : 0,
      status: b.status,
    };
  });
  const droneBatteries = state.industry.drones.map((d) => ({
    id: d.id,
    stationId: d.stationId,
    quantity: d.battery,
    capacity: droneDefinitions[d.kind].capacity,
  }));
  return { resources, utilityStores, mines, droneBatteries };
}
