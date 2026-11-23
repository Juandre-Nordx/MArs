import { expect, test, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  placement,
  routePreview,
  type ColonyState,
  type Tile,
} from '../../packages/simulation/src/index.js';

const canvas = (page: Page) => page.getByLabel('Interactive 3D colony map');
const mode = (page: Page) => page.getByLabel('Map view', { exact: true });

async function save(page: Page): Promise<ColonyState> {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
}

async function cameraPosition(page: Page) {
  const view = await canvas(page).evaluate((element) => ({
    position: element.dataset.cameraPosition!.split(',').map(Number),
    target: element.dataset.cameraTarget!.split(',').map(Number),
  }));
  return {
    position: new Vector3(...view.position),
    target: new Vector3(...view.target),
  };
}

async function screenPoint(page: Page, tile: Tile, offset = 0) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('No 3D canvas');
  const view = await cameraPosition(page);
  const camera = new PerspectiveCamera(45, box.width / box.height, 0.12, 110);
  camera.position.copy(view.position);
  camera.lookAt(view.target);
  camera.updateMatrixWorld();
  const point = new Vector3(tile.x, view.target.y + offset, tile.y).project(
    camera,
  );
  return {
    x: box.x + ((point.x + 1) * box.width) / 2,
    y: box.y + ((1 - point.y) * box.height) / 2,
  };
}

async function renderSample(page: Page) {
  return canvas(page).evaluate(async (element) => {
    const start = performance.now();
    let frames = 0;
    await new Promise<void>((resolve) => {
      function tick(now: number) {
        frames++;
        if (now - start >= 1200) resolve();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    return {
      viewport: [element.clientWidth, element.clientHeight],
      frameCallbacksPerSecond: Math.round(
        (frames * 1000) / (performance.now() - start),
      ),
      chunks: Number(element.dataset.terrainChunks),
      geometryCount: Number(element.dataset.geometries),
      drawCalls: Number(element.dataset.drawCalls),
      triangles: Number(element.dataset.triangles),
    };
  });
}

test('3D renders the existing colony, navigates, places paid construction and preserves the same save in 2D', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'Skip landing', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const initial = await save(page);

  await mode(page).selectOption('3d');
  await expect(canvas(page)).toHaveAttribute('data-terrain-chunks', '49');
  await expect
    .poll(async () => Number(await canvas(page).getAttribute('data-triangles')))
    .toBeGreaterThan(1000);
  await canvas(page).screenshot({ path: info.outputPath('3d-colony.png') });
  const balanced = await renderSample(page);
  const center = await screenPoint(page, initial.landingZone, 0.4);
  await page.mouse.click(center.x, center.y);
  await expect(
    page.getByRole('dialog', { name: 'Starship command centre' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  const camera = await cameraPosition(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -140);
  await expect
    .poll(async () => {
      const next = await cameraPosition(page);
      return next.position.distanceTo(next.target);
    })
    .toBeLessThan(camera.position.distanceTo(camera.target) - 0.25);
  const beforeOrbit = await cameraPosition(page);
  await page.keyboard.down('q');
  await expect
    .poll(async () =>
      (await cameraPosition(page)).position.distanceTo(beforeOrbit.position),
    )
    .toBeGreaterThan(0.25);
  await page.keyboard.up('q');

  const beforePan = await cameraPosition(page);
  await page.mouse.move(center.x, center.y);
  await page.keyboard.down('d');
  await expect
    .poll(async () =>
      (await cameraPosition(page)).target.distanceTo(beforePan.target),
    )
    .toBeGreaterThan(0.25);
  await page.keyboard.up('d');
  await page.getByRole('button', { name: 'Return to colony' }).click();
  await expect
    .poll(async () =>
      Math.hypot(
        (await cameraPosition(page)).target.x - initial.landingZone.x,
        (await cameraPosition(page)).target.z - initial.landingZone.y,
      ),
    )
    .toBeLessThan(0.05);
  await page.getByLabel('Graphics', { exact: true }).selectOption('low');
  await expect(canvas(page)).toHaveAttribute('data-terrain-chunks', '25');
  const low = await renderSample(page);

  await page.getByRole('button', { name: 'Housing', exact: true }).click();
  await page.getByRole('button', { name: /^Modular housing/ }).click();
  const occupied = await screenPoint(page, initial.landingZone);
  await page.mouse.move(occupied.x, occupied.y);
  await expect(page.getByTestId('placement-status')).toContainText(
    'Building footprint is occupied',
  );
  await page.mouse.click(occupied.x, occupied.y);
  await expect(page.getByTestId('placement-status')).toBeVisible();
  const sites = Array.from({ length: 81 }, (_, i) => ({
    x: initial.landingZone.x + (i % 9) - 4,
    y: initial.landingZone.y + Math.floor(i / 9) - 4,
  }));
  const tile = sites.find(
    (position) => placement(initial, 'housing', position).valid,
  );
  if (!tile) throw new Error('No valid housing site');
  const site = await screenPoint(page, tile);
  await page.mouse.move(site.x, site.y);
  await expect(page.getByTestId('placement-status')).toContainText(
    'Valid placement',
  );
  await page.mouse.click(site.x, site.y);
  await expect(
    page.getByRole('dialog', { name: 'Modular housing' }),
  ).toBeVisible();
  const built = await save(page);
  expect(built.buildings).toHaveLength(initial.buildings.length + 1);
  expect(built.inventory.metal).toBe(initial.inventory.metal - 8);
  expect(built.credits).toBe(initial.credits - 5);

  await page.keyboard.press('Escape');
  const route = sites
    .map((position) => [position, { x: position.x + 1, y: position.y }])
    .find((positions) => {
      const preview = routePreview(built, 'water', positions);
      return preview.valid && preview.cost === 0.5;
    });
  if (!route) throw new Error('No free utility route');
  await page
    .getByRole('button', { name: 'Infrastructure', exact: true })
    .click();
  await page.getByRole('button', { name: /^Water Pipe / }).click();
  const start = await screenPoint(page, route[0]!);
  const end = await screenPoint(page, route[1]!);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId('route-preview')).toContainText('2 tiles');
  await page.getByRole('button', { name: 'Confirm route' }).click();
  const completed = await save(page);
  expect(completed.infrastructure).toHaveLength(
    built.infrastructure.length + 2,
  );
  expect(completed.inventory.metal).toBe(built.inventory.metal - 0.5);

  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Browser save loaded');
  await page.getByLabel('Map X', { exact: true }).fill('511');
  await page.getByLabel('Map Y', { exact: true }).fill('511');
  await page.getByRole('button', { name: 'Go to tile', exact: true }).click();
  await expect(canvas(page)).toHaveAttribute('data-terrain-chunks', '9');
  const far = await renderSample(page);
  expect(far.geometryCount).toBeLessThan(low.geometryCount);
  await page.getByRole('button', { name: 'Return to colony' }).click();
  await expect(canvas(page)).toHaveAttribute('data-terrain-chunks', '25');
  await info.attach('3d-render-samples', {
    body: JSON.stringify({ balanced, low, far }, null, 2),
    contentType: 'application/json',
  });
  await mode(page).selectOption('2d');
  await expect(page.getByLabel('Isometric Mars terrain')).toBeVisible();
  const reloaded = await save(page);
  expect(reloaded.buildings).toEqual(completed.buildings);
  expect(reloaded.infrastructure).toEqual(completed.infrastructure);
  expect(reloaded.inventory).toEqual(completed.inventory);
  expect(reloaded.catalogue.id).toBe(completed.catalogue.id);
  expect(reloaded.tick).toBe(completed.tick);
  expect(errors).toEqual([]);
});

test('a lost WebGL context returns safely to the isometric map', async ({
  page,
}) => {
  await page.goto('/');
  await mode(page).selectOption('3d');
  await expect(canvas(page)).toHaveAttribute('data-terrain-chunks', '49');
  await canvas(page).evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('webgl2');
    const extension = context?.getExtension('WEBGL_lose_context');
    if (!extension)
      throw new Error('WebGL context loss extension is unavailable');
    extension.loseContext();
  });
  await expect(mode(page)).toHaveValue('2d');
  await expect(page.getByLabel('Isometric Mars terrain')).toBeVisible();
  await expect(
    page.getByText('3D needs WebGL 2. The isometric map is active.', {
      exact: true,
    }),
  ).toBeVisible();
});
