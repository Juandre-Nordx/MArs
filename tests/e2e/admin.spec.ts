import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { detailedTransparentPng } from '../helpers/artwork.js';
import { databaseClient } from '../../apps/api/src/database.js';
import {
  hashPassword,
  randomToken,
  hashToken,
} from '../../apps/api/src/admin-security.js';
const url = process.env.MARS_TEST_DATABASE_URL;
test.describe('administration with PostgreSQL', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test.skip(
    !url,
    'MARS_TEST_DATABASE_URL is required for real admin browser coverage',
  );
  const password = randomToken(),
    email = `browser-${randomUUID()}@example.test`;
  let db: ReturnType<typeof databaseClient>;
  test.beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
      !['/mars_v04', '/mars_test'].includes(parsed.pathname)
    )
      throw new Error(
        'Admin browser fixture requires an isolated local mars_test or mars_v04 database',
      );
    db = databaseClient(url!);
    await db.$executeRawUnsafe(
      'TRUNCATE "AdminAudit", "PublishedAsset", "PublishedCatalogue", "CatalogueAsset", "CatalogueState", "CatalogueDraft", "RecipeReference", "RecipeDefinition", "BuildingDefinition", "ResourceDefinition", "User" RESTART IDENTITY CASCADE',
    );
    await db.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        role: 'ADMIN',
      },
    });
  });
  test.afterAll(async () => {
    await db?.catalogueState.updateMany({ data: { currentVersion: null } });
    await db?.$disconnect();
  });
  test('login, planned resources, building/recipe edits, three art slots, validation and publication', async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/admin');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page
      .getByRole('button', { name: 'Initialise draft from game' })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'Initial draft seeded',
    );
    await page
      .getByRole('button', { name: 'Minerals & Resources', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Create resource', exact: true })
      .click();
    await page
      .getByLabel('Permanent ID', { exact: true })
      .fill('planned-test-alloy');
    await page.getByLabel('Name', { exact: true }).fill('Test alloy');
    await page
      .getByLabel('Description', { exact: true })
      .fill('Planned manufactured alloy for browser verification');
    await page.getByLabel('Measurement unit').selectOption('items');
    await page.getByLabel('Value (credits per unit)').fill('9');
    await page.getByLabel('Status', { exact: true }).selectOption('active');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Draft saved' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Drafts & Publishing', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Validate and preview changes' })
      .click();
    await expect(page.getByRole('alert')).toContainText(
      'unsupported active resource',
    );
    await expect(
      page.getByRole('button', { name: 'Publish validated revision' }),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'Minerals & Resources', exact: true })
      .click();
    await page.getByLabel('Search catalogue').fill('planned-test-alloy');
    await page.getByRole('button', { name: 'Test alloy', exact: true }).click();
    await page.getByLabel('Status', { exact: true }).selectOption('archived');
    const png = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 80, g: 150, b: 160, alpha: 0.7 },
      },
    })
      .png()
      .toBuffer();
    const resourceIcon = page.getByRole('group', {
      name: 'Resource icon',
      exact: true,
    });
    const input = resourceIcon.getByLabel('Upload resource icon');
    const preview = resourceIcon.getByAltText('Resource icon preview');
    await expect(input).toHaveAccessibleDescription(
      /Input up to 8 MiB.*Processed PNG limit 2 MiB/,
    );
    await input.setInputFiles({
      name: 'old.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(resourceIcon.getByRole('status')).toContainText(
      'Uploaded — save this draft',
    );
    await expect(preview).toHaveAttribute('src', /\/api\/admin\/assets\//);
    const originalPreview = await preview.getAttribute('src');

    await input.setInputFiles({
      name: 'invalid.png',
      mimeType: 'image/png',
      buffer: Buffer.from('invalid image'),
    });
    await expect(resourceIcon.getByRole('alert')).toContainText(
      'Unsupported format',
    );
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(preview).toHaveAttribute('src', originalPreview!);
    await resourceIcon.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('resource-icon-error.png'),
    });

    const generated = await detailedTransparentPng();
    expect(generated.length).toBeGreaterThan(2 * 1024 * 1024);
    const file = {
      name: 'generated.png',
      mimeType: 'image/png',
      buffer: generated,
    };
    let releaseUpload!: () => void;
    const heldUpload = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await page.route(
      '**/api/admin/assets',
      async (route) => {
        await heldUpload;
        await route.fulfill({
          status: 503,
          json: {
            error:
              'Artwork volume unavailable. Check the API volume mount and permissions.',
          },
        });
      },
      { times: 1 },
    );
    try {
      await input.setInputFiles(file);
      await expect(resourceIcon.getByRole('status')).toHaveText('Uploading…');
      await expect(input).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Save draft', exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Industry Buildings', exact: true }),
      ).toBeDisabled();
      await expect(preview).toHaveAttribute('src', originalPreview!);
    } finally {
      releaseUpload();
    }
    await expect(resourceIcon.getByRole('alert')).toContainText(
      'Artwork volume unavailable',
    );
    await expect(preview).toHaveAttribute('src', originalPreview!);
    await expect(page.getByLabel('Status', { exact: true })).toHaveValue(
      'archived',
    );

    await page.route(
      '**/api/admin/assets',
      (route) =>
        route.fulfill({
          status: 401,
          json: { error: 'Admin session expired' },
        }),
      { times: 1 },
    );
    await input.setInputFiles(file);
    await expect(resourceIcon.getByRole('alert')).toContainText(
      'administrator session has expired',
    );
    await expect(preview).toHaveAttribute('src', originalPreview!);
    await expect(page.getByLabel('Status', { exact: true })).toHaveValue(
      'archived',
    );

    await input.setInputFiles(file);
    await expect(resourceIcon.getByRole('status')).toContainText('512×512');
    await expect(preview).not.toHaveAttribute('src', originalPreview!);
    await expect
      .poll(() =>
        preview.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(512);
    const publishedIcon = (await preview.getAttribute('src'))!
      .split('/')
      .at(-1);
    await page.screenshot({
      path: testInfo.outputPath('resource-icon-success.png'),
    });
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Draft saved' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Industry Buildings', exact: true })
      .click();
    await page.getByLabel('Search catalogue').fill('housing');
    await page.locator('tbody tr').first().getByRole('button').click();
    await expect(
      page.getByLabel('Footprint width', { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('checkbox', { name: 'power', exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel('Description', { exact: true })
      .fill('Catalogue-managed housing description');
    await page.getByLabel('Upload building icon').setInputFiles(file);
    await expect(
      page
        .getByRole('group', { name: 'Building icon', exact: true })
        .getByRole('status'),
    ).toContainText('512×512');
    const buildingIcon = (await page
      .getByAltText('Building icon preview')
      .getAttribute('src'))!
      .split('/')
      .at(-1);
    await page.getByLabel('Upload isometric sprite').setInputFiles({
      name: 'sprite.webp',
      mimeType: 'image/webp',
      buffer: await sharp(png).webp().toBuffer(),
    });
    await expect(
      page
        .getByRole('group', { name: 'Isometric sprite', exact: true })
        .getByRole('status'),
    ).toContainText('Uploaded');
    await expect(
      page.getByAltText('Aligned isometric preview'),
    ).toHaveAttribute('src', /\/api\/admin\/assets\//);
    await page.getByLabel('Sprite scale', { exact: true }).fill('0.9');
    await page
      .getByAltText('Aligned isometric preview')
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/admin-dashboard.png' });
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Draft saved' }),
    ).toBeVisible();
    await page.getByLabel('Search catalogue').fill('survey-station');
    await page.locator('tbody tr').first().getByRole('button').click();
    const industrySprite = page.getByRole('group', {
      name: 'Isometric sprite',
      exact: true,
    });
    const industryInput = industrySprite.getByLabel('Upload isometric sprite');
    const industryPreview = industrySprite.getByAltText(
      'Isometric sprite preview',
    );
    const initialSprite = await industryPreview.getAttribute('src');
    await industryInput.setInputFiles({
      name: 'broken.webp',
      mimeType: 'image/webp',
      buffer: Buffer.from('bad'),
    });
    await expect(industrySprite.getByRole('alert')).toContainText(
      'Unsupported format',
    );
    await expect(industryPreview).toHaveAttribute('src', initialSprite!);
    await expect(industryInput).toHaveAccessibleDescription(
      /Processed PNG limit 8 MiB/,
    );
    await industryInput.setInputFiles(file);
    await expect(industrySprite.getByRole('status')).toContainText('1280×1280');
    await expect
      .poll(() =>
        industryPreview.evaluate(
          (image: HTMLImageElement) => image.naturalWidth,
        ),
      )
      .toBe(1280);
    const industryReference = (await industryPreview.getAttribute('src'))!
      .split('/')
      .at(-1);
    await industrySprite.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('industry-sprite-success.png'),
    });
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Draft saved' }),
    ).toBeVisible();
    await page.getByLabel('Search catalogue').fill('battery');
    await page.locator('tbody tr').first().getByRole('button').click();
    await page.getByLabel('Footprint width', { exact: true }).fill('4');
    await page.getByLabel('Footprint height', { exact: true }).fill('3');
    const batteryArt = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="224" height="150" viewBox="0 0 224 150">' +
          '<path fill="#414c54" d="M0 58L96 10l128 64-96 48z"/>' +
          '<path fill="#364853" d="M0 58l128 64v28L0 86z"/>' +
          '<path fill="#58717a" d="M128 122l96-48v28l-96 48z"/>' +
          '<path fill="#76ccb5" d="m15 71 40 20v9L15 80zm55 28 40 20v9l-40-20z"/>' +
          '</svg>',
      ),
    )
      .png()
      .toBuffer();
    await page.getByLabel('Upload isometric sprite').setInputFiles({
      name: 'battery.png',
      mimeType: 'image/png',
      buffer: batteryArt,
    });
    await expect(
      page
        .getByRole('group', { name: 'Isometric sprite', exact: true })
        .getByRole('status'),
    ).toContainText('Uploaded');
    const alignment = page.getByLabel('Sprite alignment', { exact: true });
    const anchorDot = page.locator('.admin-sprite-preview circle');
    await expect(alignment).toHaveValue('footprint-front');
    await alignment.selectOption('tile-center');
    await expect(anchorDot).toHaveAttribute('cy', '0');
    await alignment.selectOption('footprint-front');
    await expect(anchorDot).toHaveAttribute('cx', '32');
    await expect(anchorDot).toHaveAttribute('cy', '96');
    await page.getByLabel('Anchor X', { exact: true }).fill(String(128 / 224));
    await expect(page.locator('.admin-sprite-preview polygon')).toHaveCount(12);
    await page
      .getByAltText('Aligned isometric preview')
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('battery-alignment-preview.png'),
    });
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Draft saved' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Recipes', exact: true }).click();
    await page.getByLabel('Search catalogue').fill('survey-drone');
    await page.locator('tbody tr').first().getByRole('button').click();
    await page
      .getByLabel('Description', { exact: true })
      .fill('Existing survey drone assembly, pinned to this publication');
    await expect(page.getByLabel('Inputs resource 1')).toBeVisible();
    await expect(page.locator('.admin-summary')).toContainText(
      'simulation ticks',
    );
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Draft saved' }),
    ).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Unsaved recipe name');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
      'Unsaved recipe name',
    );
    page.once('dialog', (d) => d.accept());
    await page
      .getByRole('button', { name: 'Drafts & Publishing', exact: true })
      .click();
    // Recreate the invalid draft produced by the previous editor.
    await page.evaluate(async () => {
      const session = await (await fetch('/api/admin/session')).json();
      const { draft } = await (await fetch('/api/admin/catalogue')).json();
      let revision = draft.revision;
      const changes = [
        {
          ...draft.document.buildings.find(
            (entry: { id: string }) => entry.id === 'housing',
          ),
          width: 2,
        },
        {
          ...draft.document.buildings.find(
            (entry: { id: string }) => entry.id === 'underground-mine',
          ),
          utilities: ['oxygen'],
        },
      ];
      for (const entry of changes) {
        const saved = await fetch('/api/admin/entries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': session.csrfToken,
          },
          body: JSON.stringify({
            revision,
            kind: 'buildings',
            create: false,
            entry,
          }),
        });
        if (!saved.ok) throw new Error(await saved.text());
        revision = (await saved.json()).revision;
      }
    });
    await page
      .getByRole('button', { name: 'Validate and preview changes' })
      .click();
    await expect(page.getByRole('alert')).toContainText(
      'Building underground-mine: changing utility channels is unsupported. Use power.',
    );
    await expect(
      page.getByRole('button', { name: 'Publish validated revision' }),
    ).toBeDisabled();
    await page
      .getByRole('button', {
        name: 'Restore supported building layouts',
        exact: true,
      })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'Restored supported layouts for 2 buildings',
    );
    await expect(
      page.getByRole('button', {
        name: 'Restore supported building layouts',
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Validate and preview changes' })
      .click();
    await expect(page.getByRole('status')).toContainText('validated');
    await expect(
      page.getByRole('button', { name: 'Publish validated revision' }),
    ).toBeEnabled();
    await expect(
      page.getByText('buildings / housing', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Publish validated revision' })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'published atomically',
    );
    const published = await page.request.get('/api/catalogues/current');
    expect(published.ok()).toBe(true);
    const snapshot = await published.json();
    const publishedBattery = snapshot.document.buildings.find(
      (b: { id: string }) => b.id === 'battery',
    );
    expect(publishedBattery).toMatchObject({
      width: 4,
      height: 3,
      spriteAlignment: 'footprint-front',
    });
    expect(
      snapshot.document.resources.find(
        (r: { id: string }) => r.id === 'planned-test-alloy',
      ).icon,
    ).toBe(publishedIcon);
    expect(
      snapshot.document.resources.find(
        (r: { id: string }) => r.id === 'planned-test-alloy',
      ).unit,
    ).toBe('items');
    const housing = snapshot.document.buildings.find(
      (b: { id: string }) => b.id === 'housing',
    );
    expect(housing).toMatchObject({
      width: 1,
      height: 1,
      scale: 0.9,
      icon: buildingIcon,
    });
    expect(
      snapshot.document.buildings.find(
        (b: { id: string }) => b.id === 'survey-station',
      ).sprite,
    ).toBe(industryReference);
    const publishedSprite = await page.request.get(
      `/api/catalogue-assets/${industryReference}`,
    );
    expect(publishedSprite.ok()).toBe(true);
    expect((await publishedSprite.body()).length).toBeGreaterThan(
      2 * 1024 * 1024,
    );
    expect(
      (await page.request.get(`/api/catalogue-assets/${housing.sprite}`)).ok(),
    ).toBe(true);
    await page.goto('/');
    await page.locator('.catalogue-options summary').click();
    await page.getByLabel('New colony catalogue').selectOption(snapshot.id);
    const loadedBatterySprite = page.waitForResponse(
      (res) =>
        res
          .url()
          .endsWith(`/api/catalogue-assets/${publishedBattery.sprite}`) &&
        res.ok(),
    );
    await page.getByRole('button', { name: 'New game', exact: true }).click();
    await page.getByRole('button', { name: 'Skip landing' }).click();
    await loadedBatterySprite;
    await expect(page.locator('canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('mars-first-colony-save')!),
    );
    expect(saved.catalogue.id).toBe(snapshot.id);
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Browser save loaded');
    const battery = saved.buildings.find(
      (b: { type: string }) => b.type === 'battery',
    );
    await page.getByLabel('Map X', { exact: true }).fill(String(battery.x + 3));
    await page.getByLabel('Map Y', { exact: true }).fill(String(battery.y + 2));
    await page.getByRole('button', { name: 'Go to tile', exact: true }).click();
    const batteryPanel = page.getByRole('dialog', {
      name: 'Energy storage system',
    });
    await expect(batteryPanel).toContainText('4×3 tiles');
    await page.screenshot({
      path: testInfo.outputPath('battery-footprint.png'),
    });
    await page.keyboard.press('Escape');
    await page.route(`**/api/catalogue-assets/${housing.icon}`, (route) =>
      route.fulfill({
        status: 404,
        json: { error: 'Artwork file missing from the API volume' },
      }),
    );
    await page.getByRole('button', { name: 'Housing', exact: true }).click();
    const icon = page.locator('.build-menu .build-icon');
    await expect(icon).toHaveAttribute('src', /^data:image\/svg/);
    await expect(icon).toHaveAttribute('title', /placeholder shown/);
    expect(errors).toEqual([]);
  });
  test('ordinary player cannot use admin endpoints or dashboard', async ({
    page,
    context,
    baseURL,
  }) => {
    const token = randomToken();
    const user = await db.user.create({
      data: { email: `player-${randomUUID()}@example.test` },
    });
    await db.adminSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        csrfToken: randomToken(),
        expiresAt: new Date(Date.now() + 100000),
      },
    });
    await context.addCookies([
      {
        name: process.env.MARS_TEST_WEB_URL
          ? '__Host-mars-admin'
          : 'mars-admin',
        value: token,
        domain: new URL(baseURL!).hostname,
        path: '/',
        secure: !!process.env.MARS_TEST_WEB_URL,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await page.goto('/admin');
    await expect(page.getByRole('alert')).toContainText(
      'Administrator permission required',
    );
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () => {
        const response = await fetch('/api/admin/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: 1 }),
        });
        return response.status;
      }),
    ).toBe(403);
  });
});
