import { expect, test } from '@playwright/test';

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
    await page.getByPlaceholder('Enter password...').fill('synthetic-e2e-password');
    await page.getByRole('button', { name: 'Enter', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: game.title });
    await expect(dialog).toBeVisible();
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
