import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
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
  }) => {
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
    await expect(page.getByRole('status')).toContainText('Draft saved');
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
    await page
      .getByLabel('Upload resource icon')
      .setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('status')).toContainText('Artwork uploaded');
    await expect(page.getByAltText('Resource icon preview')).toHaveAttribute(
      'src',
      /\/api\/admin\/assets\//,
    );
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Draft saved');
    await page
      .getByRole('button', { name: 'Industry Buildings', exact: true })
      .click();
    await page.getByLabel('Search catalogue').fill('housing');
    await page.locator('tbody tr').first().getByRole('button').click();
    await page
      .getByLabel('Description', { exact: true })
      .fill('Catalogue-managed housing description');
    await page
      .getByLabel('Upload building icon')
      .setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('status')).toContainText('Artwork uploaded');
    await page.getByLabel('Upload isometric sprite').setInputFiles({
      name: 'sprite.webp',
      mimeType: 'image/webp',
      buffer: await sharp(png).webp().toBuffer(),
    });
    await expect(page.getByRole('status')).toContainText('Artwork uploaded');
    await expect(
      page.getByAltText('Aligned isometric preview'),
    ).toHaveAttribute('src', /\/api\/admin\/assets\//);
    await page.getByLabel('Sprite scale', { exact: true }).fill('0.9');
    await page
      .getByAltText('Aligned isometric preview')
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/admin-dashboard.png' });
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Draft saved');
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
    await expect(page.getByRole('status')).toContainText('Draft saved');
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
    expect(
      snapshot.document.resources.find(
        (r: { id: string }) => r.id === 'planned-test-alloy',
      ).unit,
    ).toBe('items');
    const housing = snapshot.document.buildings.find(
      (b: { id: string }) => b.id === 'housing',
    );
    expect(
      (await page.request.get(`/api/catalogue-assets/${housing.sprite}`)).ok(),
    ).toBe(true);
    await page.goto('/');
    await page.getByLabel('New colony catalogue').selectOption(snapshot.id);
    await page.getByRole('button', { name: 'New game', exact: true }).click();
    await page.getByRole('button', { name: 'Skip landing' }).click();
    await expect(page.locator('canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('mars-first-colony-save')!),
    );
    expect(saved.catalogue.id).toBe(snapshot.id);
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Browser save loaded');
    expect(errors).toEqual([]);
  });
  test('ordinary player cannot use admin endpoints or dashboard', async ({
    page,
    context,
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
        name: 'mars-admin',
        value: token,
        url: 'http://127.0.0.1:5173',
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
      (
        await page.request.post('/api/admin/publish', {
          data: { revision: 1 },
          headers: { origin: 'http://127.0.0.1:5173' },
        })
      ).status(),
    ).toBe(403);
  });
});
