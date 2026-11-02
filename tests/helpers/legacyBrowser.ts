import type { Page } from '@playwright/test';
import { legacyGame } from './landing.js';
// Original interaction cases use absolute legacy tile coordinates. Keep those
// fixtures stable; central landings use the real endpoint in landing.spec.ts.
export async function useLegacyNewGames(page: Page) {
  await page.route('**/api/new-game', (route) => {
    const request = route.request().postDataJSON() as { seed: number };
    return route.fulfill({
      json: { colony: legacyGame(request.seed), persistence: 'none' },
    });
  });
}
