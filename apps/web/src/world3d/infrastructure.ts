import {
  adjacent,
  buildingAt,
  connectionTiles,
  infrastructureDefinitions,
  infrastructureTypeSchema,
  isUsable,
  runtimeCatalogue,
  segmentId,
  type ColonyState,
  type InfrastructureType,
  type Tile,
} from '@mars/simulation';
import { foundationRange, surfaceAt } from './terrain';

export type View = InfrastructureType | 'normal' | 'geology';
type Point = [number, number, number];
export type Link = {
  from: Point;
  to: Point;
  color: number;
  brightness: number;
  type: InfrastructureType;
};

export function infrastructureLinks(
  colony: ColonyState,
  visible: (tile: Tile) => boolean,
  view: View,
  selected: Tile | null,
) {
  const links: Link[] = [];
  const segments = new Map(
    colony.infrastructure.map((segment) => [segment.id, segment]),
  );
  const definitions = runtimeCatalogue(colony).buildings;
  const selectedBuilding = selected && buildingAt(colony, selected);
  const highlights = new Set(
    colony.networks
      .filter((network) =>
        selectedBuilding
          ? network.buildings.includes(selectedBuilding.id)
          : selected &&
            network.segments.includes(segmentId(network.type, selected)),
      )
      .flatMap((network) => network.segments),
  );
  const offset = { road: 0, water: -0.16, oxygen: 0.16, power: 0.04 };
  function point(
    type: InfrastructureType,
    x: number,
    z: number,
    height?: number,
  ): Point {
    x += offset[type];
    z += offset[type];
    const base = height ?? surfaceAt(colony.seed, x, z, colony.landingZone);
    return [x, base + (type === 'road' ? 0.045 : 0.105), z];
  }
  function appearance(type: InfrastructureType, id: string, live: boolean) {
    return {
      type,
      color: live
        ? type === 'road'
          ? 0x827268
          : infrastructureDefinitions[type].color
        : 0xde6b4e,
      brightness:
        view !== 'normal' && view !== type
          ? 0.25
          : highlights.size && !highlights.has(id)
            ? 0.45
            : 1,
    };
  }
  for (const segment of colony.infrastructure) {
    if (!visible(segment)) continue;
    const { type, x, y, id } = segment;
    const live = isUsable(segment);
    const style = appearance(type, id, live);
    const center = point(type, x, y);
    // Every placed tile has a short visible cap, including isolated/faulted segments.
    links.push({
      from: [center[0] - 0.08, center[1], center[2]],
      to: [center[0] + 0.08, center[1], center[2]],
      ...style,
    });
    if (!live) continue;
    for (const tile of adjacent(segment)) {
      const other = segments.get(segmentId(type, tile));
      if (!other || !isUsable(other) || (visible(other) && id > other.id))
        continue;
      const edge = point(type, (x + tile.x) / 2, (y + tile.y) / 2);
      links.push(
        { from: center, to: edge, ...style },
        { from: edge, to: point(type, tile.x, tile.y), ...style },
      );
    }
  }
  for (const building of colony.buildings) {
    const { width, height } = definitions[building.type];
    let foundationTop: number | undefined;
    for (const type of infrastructureTypeSchema.options)
      for (const tile of connectionTiles(building, type, colony)) {
        const segment = segments.get(segmentId(type, tile));
        if (!segment || !isUsable(segment) || !visible(tile)) continue;
        const x = Math.min(
          building.x + width - 1,
          Math.max(building.x, tile.x),
        );
        const z = Math.min(
          building.y + height - 1,
          Math.max(building.y, tile.y),
        );
        const edge = { x: (x + tile.x) / 2, z: (z + tile.y) / 2 };
        foundationTop ??=
          foundationRange(
            colony.seed,
            colony.landingZone,
            building,
            width,
            height,
          ).high + 0.1;
        const start = point(type, tile.x, tile.y);
        const near = point(type, edge.x, edge.z);
        const end = point(
          type,
          edge.x + (x - tile.x) * 0.2,
          edge.z + (z - tile.y) * 0.2,
          foundationTop,
        );
        const style = appearance(type, segment.id, true);
        links.push(
          { from: start, to: near, ...style },
          { from: near, to: end, ...style },
        );
      }
  }
  return links;
}
