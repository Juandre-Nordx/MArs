import { CHUNK_SIZE, WORLD_SIZE, type Tile } from '@mars/simulation';
import { tileToWorld, worldToTile } from './iso';
export type Viewport = { x: number; y: number; width: number; height: number };
// Inverse-project viewport corners; test chunk screen bounds to reject offscreen diagonals.
export function visibleChunks(view: Viewport): Tile[] {
  const corners = [
    worldToTile(view.x, view.y),
    worldToTile(view.x + view.width, view.y),
    worldToTile(view.x, view.y + view.height),
    worldToTile(view.x + view.width, view.y + view.height),
  ];
  const loX = Math.max(
      0,
      Math.floor((Math.min(...corners.map((c) => c.x)) - 2) / CHUNK_SIZE),
    ),
    loY = Math.max(
      0,
      Math.floor((Math.min(...corners.map((c) => c.y)) - 2) / CHUNK_SIZE),
    ),
    hiX = Math.min(
      WORLD_SIZE / CHUNK_SIZE - 1,
      Math.floor((Math.max(...corners.map((c) => c.x)) + 2) / CHUNK_SIZE),
    ),
    hiY = Math.min(
      WORLD_SIZE / CHUNK_SIZE - 1,
      Math.floor((Math.max(...corners.map((c) => c.y)) + 2) / CHUNK_SIZE),
    );
  const result: Tile[] = [];
  for (let y = loY; y <= hiY; y++)
    for (let x = loX; x <= hiX; x++) {
      const p = tileToWorld(x * CHUNK_SIZE, y * CHUNK_SIZE);
      if (
        p.x + CHUNK_SIZE * 32 + 32 >= view.x &&
        p.x - CHUNK_SIZE * 32 - 32 <= view.x + view.width &&
        p.y + CHUNK_SIZE * 32 + 16 >= view.y &&
        p.y - 16 <= view.y + view.height
      )
        result.push({ x, y });
    }
  return result;
}
export function nearViewport(
  tile: Tile,
  view: Viewport,
  padding = 96,
): boolean {
  const p = tileToWorld(tile.x, tile.y);
  return (
    p.x >= view.x - padding &&
    p.x <= view.x + view.width + padding &&
    p.y >= view.y - padding &&
    p.y <= view.y + view.height + padding
  );
}
