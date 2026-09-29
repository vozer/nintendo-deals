import { expect, test } from '@playwright/test';
import axe from 'axe-core';

const game = {
  fs_id: '1337462',
  title: 'Synthetic Deep Link Game',
  image_url_sq_s: 'https://example.test/game.jpg',
  price_regular_f: 19.99,
  price_discounted_f: 4.99,
  price_discount_percentage_f: 75,
  price_has_discount_b: true,
  excerpt: 'A hand-painted adventure.',
  url: '/es-es/games/example',
  pretty_game_categories_txt: ['Adventure'],
  publisher: 'Synthetic Publisher',
  system_names_txt: ['Nintendo Switch'],
  pretty_agerating_s: 'PEGI 7',
  pretty_date_s: '2026-01-01',
  price_lowest_f: 4.99,
};

async function stubLocalApis(page: import('@playwright/test').Page) {
  await page.route('**/game.jpg', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#fff"/></svg>',
  }));
  await page.route('**/api/games*', (route) => route.fulfill({ json: { games: [], total: 0 } }));
  await page.route('**/api/game?*', (route) => route.fulfill({ json: { game } }));
  await page.route('**/api/preferences', (route) => route.fulfill({
    json: { hiddenGames: [], watchGames: {}, thinkingAbout: [] },
  }));
  await page.route('**/api/ratings', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/media', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/steam', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/curated', (route) => route.fulfill({
    json: {
      nintendolife: {
        '1337462': {
          title: game.title,
          review: 'A synthetic editorial note.',
          source_url: 'https://example.test/editorial',
          source: 'nintendolife',
        },
      },
      ntdeals: {
        '1337462': {
          title: game.title,
          review: '',
          source_url: 'https://example.test/deal',
          source: 'ntdeals',
          source_price_eur: 4.99,
        },
      },
    },
  }));
}

for (const viewport of [{ width: 375, height: 812 }, { width: 1200, height: 900 }]) {
  test(`login preserves game deep link and dialog is usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await stubLocalApis(page);
    await page.goto('/?game=1337462');

    await expect(page).toHaveURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/?game=1337462');
    await page.addScriptTag({ content: axe.source });
    const loginViolations = await page.evaluate(async () => {
      const axeOnWindow = (window as unknown as { axe: typeof axe }).axe;
      const scan = await axeOnWindow.run(document);
      return scan.violations.map((violation) => ({ id: violation.id, impact: violation.impact }));
    });
    expect(loginViolations).toEqual([]);
    await page.getByPlaceholder('Enter password...').fill('synthetic-e2e-password');
    await page.getByRole('button', { name: 'Enter', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: game.title });
    await expect(dialog).toBeVisible();
    const seriousViolations = await page.evaluate(async () => {
      const axeOnWindow = (window as unknown as { axe: typeof axe }).axe;
      const results = await axeOnWindow.run(document);
      return results.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target) }));
    });
    expect(seriousViolations).toEqual([]);
    await expect(dialog.getByText('A synthetic editorial note.')).toBeVisible();
    await expect(dialog.getByText('NT Deals', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close game details' })).toBeFocused();

    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(viewport.width);
    for (let index = 0; index < 30; index += 1) await page.keyboard.press('Tab');
    const focusStayedInDialog = await page.evaluate(() =>
      document.querySelector('dialog[open]')?.contains(document.activeElement) ?? false,
    );
    expect(focusStayedInDialog).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
}
