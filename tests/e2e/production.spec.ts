import { test, expect, type Page } from '@playwright/test';
import { charged } from '../helpers/industry.js';
import type { ColonyState } from '../../packages/simulation/src/index.js';
async function load(page: Page, state = charged()) {
  state.speed = 0;
  await page.goto('/');
  await page.evaluate(
    (s) => localStorage.setItem('mars-first-colony-save', JSON.stringify(s)),
    state,
  );
  await page.getByRole('button', { name: 'Load', exact: true }).click();
}
async function save(page: Page): Promise<ColonyState> {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('mars-first-colony-save')!),
  );
}
async function openStation(page: Page) {
  await page.getByText(/Building roster \(/, { exact: false }).click();
  await page
    .getByRole('button', { name: /^Survey and drone station ·/ })
    .click();
  return page.getByRole('dialog', {
    name: 'Survey and drone station',
    exact: true,
  });
}
test('building popup supports roster switching, close, Escape and continuous camera interaction', async ({
  page,
}) => {
  await load(page);
  const popup = await openStation(page);
  await expect(
    popup.getByRole('img', { name: /placeholder artwork/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Warehouse ·/ }).click();
  const warehouse = page.getByRole('dialog', {
    name: 'Warehouse',
    exact: true,
  });
  await expect(warehouse).toBeVisible();
  await expect(
    warehouse.getByRole('region', { name: 'Production queue' }),
  ).toHaveCount(0);
  await warehouse
    .getByRole('button', { name: 'Close building information' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('button', { name: /^Survey and drone station ·/ })
    .click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const canvas = page.locator('canvas'),
    box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(
    page.getByRole('dialog', { name: 'Starship command centre', exact: true }),
  ).toBeVisible();
  await page.mouse.move(box.x + 130, box.y + 180);
  await page.mouse.wheel(0, -100);
  await expect(
    page.getByRole('dialog', { name: 'Starship command centre', exact: true }),
  ).toBeVisible();
});
test('reserves two orders, cancels one, saves selections and resumes live powered production without world commands', async ({
  page,
}) => {
  const initial = charged();
  await load(page, initial);
  const popup = await openStation(page);
  const selection = await page.getByTestId('selection').innerText();
  await expect(popup.getByTestId('product-cost')).toContainText('15 metal');
  await popup
    .getByRole('button', { name: 'Queue survey drone', exact: true })
    .click();
  await popup
    .getByRole('button', { name: 'Queue survey drone', exact: true })
    .click();
  await expect(popup.getByTestId('production-order')).toHaveCount(2);
  let s = await save(page);
  expect(s.inventory.metal).toBe(initial.inventory.metal - 30);
  expect(s.production.orders).toHaveLength(2);
  expect(s.buildings).toEqual(initial.buildings);
  expect(s.infrastructure).toEqual(initial.infrastructure);
  await expect(page.getByTestId('selection')).toHaveText(selection);
  await popup
    .getByRole('button', { name: 'Cancel order-1', exact: true })
    .click();
  s = await save(page);
  expect(s.inventory.metal).toBe(initial.inventory.metal - 15);
  await popup.getByLabel('Available product').selectOption('extraction-drone');
  await expect(popup.getByTestId('product-cost')).toContainText('20 metal');
  await popup.getByLabel('Available product').selectOption('survey-drone');
  await popup
    .getByRole('button', { name: 'Queue survey drone', exact: true })
    .click();
  await popup
    .getByRole('button', { name: 'Disable building', exact: true })
    .click();
  await expect(
    popup.getByRole('region', { name: 'Production queue' }),
  ).toContainText('Building disabled');
  await page.getByRole('button', { name: '4×', exact: true }).click();
  await page.waitForTimeout(400);
  s = await save(page);
  expect(s.production.orders.every((o) => o.progress === 0)).toBe(true);
  await popup
    .getByRole('button', { name: 'Enable building', exact: true })
    .click();
  await expect(popup.getByTestId('fleet-capacity')).toContainText(
    'Fleet: 4 deployed',
    { timeout: 30000 },
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  s = await save(page);
  expect(s.production.orders).toHaveLength(0);
  expect(
    s.industry.drones.filter((d) => d.id.startsWith('produced-')),
  ).toHaveLength(2);
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const reloaded = await save(page);
  expect(reloaded.industry.drones).toEqual(s.industry.drones);
  expect(reloaded.production).toEqual(s.production);
});
test('reports insufficient materials without reserving an order or changing terrain selection', async ({
  page,
}) => {
  const s = charged();
  s.inventory.metal = 14;
  await load(page, s);
  const popup = await openStation(page);
  await popup
    .getByRole('button', { name: 'Queue survey drone', exact: true })
    .click();
  await expect(popup.getByRole('alert')).toHaveText(
    'Insufficient shared colony materials',
  );
  expect((await save(page)).production.orders).toHaveLength(0);
  expect((await save(page)).inventory.metal).toBe(14);
});
