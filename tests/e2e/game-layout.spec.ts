import { expect, test } from '@playwright/test';
import { charged } from '../helpers/industry.js';

for (const [width, height] of [
  [1920, 1080],
  [1366, 768],
  [1280, 720],
  [1024, 768],
]) {
  test(`game HUD and production panel fit at ${width}×${height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const icons = page.locator('.hud-icon');
    await expect(icons).toHaveCount(4);
    for (const icon of await icons.all()) {
      await expect(icon).toHaveCSS('width', '22px');
      await expect(icon).toHaveCSS('height', '22px');
      await expect(icon).toHaveCSS('object-fit', 'contain');
      await expect
        .poll(() =>
          icon.evaluate((img) => (img as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(24);
    }

    const colony = charged();
    colony.speed = 0;
    await page.evaluate((state) => {
      localStorage.setItem('mars-first-colony-save', JSON.stringify(state));
    }, colony);
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    const header = await page.locator('.topbar').boundingBox();
    const map = page.locator('.viewport');
    const mapBox = await map.boundingBox();
    const toolbar = await page
      .getByRole('navigation', { name: 'Construction categories' })
      .boundingBox();
    expect(header && mapBox && toolbar).toBeTruthy();
    expect(header!.height).toBeLessThan(125);
    expect(mapBox!.height).toBeGreaterThan(height * 0.7);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);

    const inspector = page.locator('#colony-inspector');
    await page.getByRole('button', { name: 'Hide inspector' }).click();
    await expect(inspector).toBeHidden();
    expect((await map.boundingBox())!.width).toBeGreaterThan(mapBox!.width);
    if (width === 1366) {
      await page.getByRole('button', { name: 'Dismiss message' }).click();
      await page.screenshot({ path: testInfo.outputPath('mars-map.png') });
    }
    await page.getByRole('button', { name: 'Show inspector' }).click();
    await expect(inspector).toBeVisible();
    await page.getByText(/Building roster \(/).click();
    await page
      .getByRole('button', { name: /^Survey and drone station ·/ })
      .click();
    const popup = page.getByRole('dialog', {
      name: 'Survey and drone station',
    });
    await expect(popup).toBeVisible();
    const panel = (await popup.boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    expect(panel.y + panel.height).toBeLessThanOrEqual(toolbar!.y);
    expect(panel.x).toBeGreaterThan(mapBox!.x);
    expect(panel.x + panel.width).toBeLessThanOrEqual(
      mapBox!.x + mapBox!.width,
    );
    await page.getByRole('button', { name: '2×', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Pause', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await popup
      .getByRole('button', { name: 'Queue survey drone', exact: true })
      .click();
    await expect(popup.getByTestId('production-order')).toHaveCount(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    if (width === 1366)
      await page.screenshot({
        path: testInfo.outputPath('mars-production.png'),
      });
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);

    await page.getByRole('button', { name: 'Housing', exact: true }).click();
    const housing = page
      .locator('.build-menu')
      .getByRole('button', { name: /^Modular housing/ });
    await expect(housing.locator('img')).toHaveCSS('width', '34px');
    await housing.click();
    await expect(page.getByTestId('placement-status')).toContainText('metal');
    await page.getByRole('button', { name: 'Cancel placement' }).click();
    await expect(page.getByTestId('placement-status')).toHaveCount(0);
  });
}
