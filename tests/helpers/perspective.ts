import { expect, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { surfaceAt } from '../../apps/web/src/world3d/heightmap.js';
import type { Tile } from '../../packages/simulation/src/terrain.js';

export const worldCanvas = (page: Page) =>
  page.getByLabel('Interactive 3D colony map');

export async function cameraPose(page: Page) {
  const canvas = worldCanvas(page);
  await expect(canvas).toHaveAttribute('data-camera-position', /,/);
  const data = await canvas.evaluate((element) => ({
    position: element.dataset.cameraPosition!.split(',').map(Number),
    target: element.dataset.cameraTarget!.split(',').map(Number),
    seed: Number(element.dataset.terrainSeed),
    landing: element.dataset.landingTile!.split(',').map(Number),
  }));
  return {
    position: new Vector3(...data.position),
    target: new Vector3(...data.target),
    seed: data.seed,
    landing: { x: data.landing[0]!, y: data.landing[1]! },
  };
}

export async function screenPoint(page: Page, tile: Tile, height = 0) {
  const pose = await cameraPose(page);
  const box = await worldCanvas(page).boundingBox();
  if (!box) throw new Error('Missing 3D map');
  const camera = new PerspectiveCamera(45, box.width / box.height, 0.12, 110);
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  camera.updateMatrixWorld();
  const point = new Vector3(
    tile.x,
    surfaceAt(pose.seed, tile.x, tile.y, pose.landing) + height,
    tile.y,
  ).project(camera);
  return {
    x: box.x + ((point.x + 1) * box.width) / 2,
    y: box.y + ((1 - point.y) * box.height) / 2,
  };
}

export async function clickTile(page: Page, tile: Tile, height = 0) {
  const point = await screenPoint(page, tile, height);
  await page.mouse.click(point.x, point.y);
}
