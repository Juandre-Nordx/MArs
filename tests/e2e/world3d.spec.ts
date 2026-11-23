import { expect, test, type Page } from '@playwright/test';
import {
  cameraPose,
  screenPoint,
  worldCanvas as canvas,
} from '../helpers/perspective.js';
import {
  placement,
  routePreview,
  type ColonyState,
} from '../../packages/simulation/src/index.js';

async function save(page: Page): Promise<ColonyState> {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
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

test('3D renders the existing colony, navigates, places paid construction and preserves the same save after reload', async ({
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

  await expect(page.getByLabel('Map view', { exact: true })).toHaveCount(0);
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
  await page
    .getByRole('button', { name: 'Focus building', exact: true })
    .click();
  await expect
    .poll(async () => (await cameraPose(page)).target.x)
    .toBeCloseTo(initial.landingZone.x + 0.5);
  await page.keyboard.press('Escape');

  const camera = await cameraPose(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -140);
  await expect
    .poll(async () => {
      const next = await cameraPose(page);
      return next.position.distanceTo(next.target);
    })
    .toBeLessThan(camera.position.distanceTo(camera.target) - 0.25);
  const beforeOrbit = await cameraPose(page);
  await page.keyboard.down('q');
  await expect
    .poll(async () =>
      (await cameraPose(page)).position.distanceTo(beforeOrbit.position),
    )
    .toBeGreaterThan(0.25);
  await page.keyboard.up('q');

  const beforePan = await cameraPose(page);
  await page.mouse.move(center.x, center.y);
  await page.keyboard.down('d');
  await expect
    .poll(async () =>
      (await cameraPose(page)).target.distanceTo(beforePan.target),
    )
    .toBeGreaterThan(0.25);
  await page.keyboard.up('d');
  await page.getByRole('button', { name: 'Return to colony' }).click();
  await expect
    .poll(
      async () =>
        Math.hypot(
          (await cameraPose(page)).target.x - initial.landingZone.x,
          (await cameraPose(page)).target.z - initial.landingZone.y,
        ),
      { timeout: 12000 },
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
  await page.keyboard.press('r');
  await expect(
    page.getByRole('button', { name: /Rotate model.*90/ }),
  ).toBeVisible();
  await page.mouse.click(site.x, site.y);
  await expect(
    page.getByRole('dialog', { name: 'Modular housing' }),
  ).toBeVisible();
  const built = await save(page);
  expect(built.buildings).toHaveLength(initial.buildings.length + 1);
  expect(built.buildings.at(-1)).toMatchObject({ ...tile, modelYaw: 90 });
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

  const reloaded = await save(page);
  expect(reloaded.buildings).toEqual(completed.buildings);
  expect(reloaded.infrastructure).toEqual(completed.infrastructure);
  expect(reloaded.inventory).toEqual(completed.inventory);
  expect(reloaded.catalogue.id).toBe(completed.catalogue.id);
  expect(reloaded.tick).toBe(completed.tick);
  expect(errors).toEqual([]);
});

test('a lost WebGL context can restart the perspective map', async ({
  page,
}) => {
  await page.goto('/');
  await expect(canvas(page)).toHaveAttribute('data-terrain-chunks', '49');
  await canvas(page).evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('webgl2');
    const extension = context?.getExtension('WEBGL_lose_context');
    if (!extension)
      throw new Error('WebGL context loss extension is unavailable');
    extension.loseContext();
  });
  await expect(page.getByRole('alert')).toContainText('WebGL 2');
  await page.getByRole('button', { name: 'Retry 3D map' }).click();
  await expect(canvas(page)).toHaveAttribute('data-terrain-chunks', '49');
});

test('right drag orbits through 360 degrees and adjusts tilt, and middle drag pans', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Graphics').selectOption('low');
  await expect(canvas(page)).toHaveAttribute('data-terrain-chunks', '25');
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('Missing 3D map');
  const x = box.x + box.width * 0.43;
  const y = box.y + box.height * 0.48;
  const initial = await cameraPose(page);
  const azimuth = ({
    position,
    target,
  }: Awaited<ReturnType<typeof cameraPose>>) =>
    Math.atan2(position.x - target.x, position.z - target.z);
  const angleDelta = (a: number, b: number) =>
    Math.atan2(Math.sin(a - b), Math.cos(a - b));
  let previous = azimuth(initial);
  let travelled = 0;
  for (let drag = 0; drag < 8; drag++) {
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(x + box.height * 0.22, y + (drag === 0 ? 35 : 0), {
      steps: 5,
    });
    await page.mouse.up({ button: 'right' });
    await expect
      .poll(async () =>
        Math.abs(angleDelta(azimuth(await cameraPose(page)), previous)),
      )
      .toBeGreaterThan(0.9);
    const next = azimuth(await cameraPose(page));
    travelled += angleDelta(next, previous);
    previous = next;
  }
  expect(Math.abs(travelled)).toBeGreaterThan(2 * Math.PI);
  const tilted = await cameraPose(page);
  expect(
    Math.abs(
      tilted.position.y -
        tilted.target.y -
        (initial.position.y - initial.target.y),
    ),
  ).toBeGreaterThan(0.2);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x + 64, y + 32, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await expect
    .poll(async () => (await cameraPose(page)).target.distanceTo(tilted.target))
    .toBeGreaterThan(0.6);
  expect(
    Number(await canvas(page).getAttribute('data-camera-clearance')),
  ).toBeGreaterThanOrEqual(0.54);
});
