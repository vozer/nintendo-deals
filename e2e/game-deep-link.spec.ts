import { expect, test } from '@playwright/test';
import axe from 'axe-core';
import { readFile } from 'node:fs/promises';

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
  test(`details share persistent actions, Steam links and playable media at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    if (viewport.width === 375) await page.addInitScript(() => {
      const native = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (type: string) {
        return type === 'application/vnd.apple.mpegurl' ? '' : native.call(this, type);
      };
    });
    await stubLocalApis(page);
    await page.route('**/_next/static/chunks/**', async (route) => {
      if (route.request().url().includes('hls')) await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    const prefs = { hiddenGames: ['999'], watchGames: { '888': { threshold: 10, title: 'Untouched watch' } } as Record<string, { threshold: number; title: string }>, thinkingAbout: ['777'] };
    const mutations: Record<string, unknown>[] = [];
    let failNext = true;
    let loseThinkingReply = true;
    await page.route('**/api/preferences', (route) => route.fulfill({ json: prefs }));
    await page.route('**/api/games*', (route) => route.fulfill({ json: { games: [game], total: 1 } }));
    await page.route('**/api/media', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ json: { [game.fs_id]: {
        screenshots: ['https://images.igdb.com/synthetic-a.png', 'https://images.igdb.com/synthetic-b.png'],
        asset_sources: { 'https://images.igdb.com/synthetic-a.png': 'nintendo', 'https://images.igdb.com/synthetic-b.png': 'steam' },
        videos: [{ video_id: '1', name: 'Gameplay', type: 'steam', source: 'steam', hls_url: 'https://video.fastly.steamstatic.com/synthetic.m3u8', source_url: 'https://store.steampowered.com/app/4235410/' }, { video_id: 'abcdefghijk', name: 'Another trailer', type: 'youtube' }],
        source: 'mixed', igdb_url: null, last_updated: 'today', steam_match: { steam_id: 4235410, matched_title: game.title, publisher: game.publisher, last_updated: 'today' },
      } } });
    });
    await page.route('https://images.igdb.com/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#456b55"/></svg>' }));
    await page.route('https://video.fastly.steamstatic.com/**', async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop()!;
      if (!/^synthetic(?:-\d+\.mpegts|\.m3u8)$/.test(name)) return route.abort();
      await route.fulfill({ contentType: name.endsWith('.mpegts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl', headers: { 'access-control-allow-origin': '*' }, body: await readFile(`e2e/fixtures/hls/${name}`) });
    });
    await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Synthetic YouTube player</p>' }));
    await page.route('**/api/preferences/actions', async (route) => {
      const action = route.request().postDataJSON(); mutations.push(action);
      if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: 'synthetic failure' } }); }
      if (action.action === 'hide') prefs.hiddenGames.push(game.fs_id);
      if (action.action === 'unhide') prefs.hiddenGames = prefs.hiddenGames.filter((id) => id !== game.fs_id);
      if (action.action === 'watch') prefs.watchGames[game.fs_id] = { threshold: action.threshold, title: action.title };
      if (action.action === 'unwatch') delete prefs.watchGames[game.fs_id];
      if (action.action === 'toggle_thinking') prefs.thinkingAbout = prefs.thinkingAbout.includes(game.fs_id) ? prefs.thinkingAbout.filter((id) => id !== game.fs_id) : [...prefs.thinkingAbout, game.fs_id];
      if (action.action === 'toggle_thinking' && loseThinkingReply) { loseThinkingReply = false; return route.fulfill({ status: 503, json: { error: 'saved but reply lost' } }); }
      await route.fulfill({ json: { game: { fs_id: game.fs_id, hidden: prefs.hiddenGames.includes(game.fs_id), watch: prefs.watchGames[game.fs_id] ?? null, thinking: prefs.thinkingAbout.includes(game.fs_id) } } });
    });
    await page.goto('/?game=1337462');
    await page.getByPlaceholder('Enter password...').fill('synthetic-e2e-password');
    await page.getByRole('button', { name: 'Enter', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: game.title });
    await expect(dialog.getByRole('button', { name: 'Screenshots (2)' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Steam Reviews' })).toHaveAttribute('href', 'https://store.steampowered.com/app/4235410/');
    await expect(page.getByRole('link', { name: 'Steam', exact: true })).toHaveCount(1);
    expect(mutations).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Gameplay (PC)', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Gameplay (PC)', exact: true })).toBeFocused();
    const supportsNativeHls = await dialog.locator('video').evaluate((element: HTMLVideoElement) => Boolean(element.canPlayType('application/vnd.apple.mpegurl')));
    if (!supportsNativeHls) await expect(dialog.locator('video')).not.toHaveAttribute('src', /\.m3u8/);
    await expect(dialog.locator('video')).toHaveAttribute('controls', '');
    await dialog.locator('video').evaluate((element: HTMLVideoElement) => element.play());
    await expect.poll(() => dialog.locator('video').evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: 'Another trailer', exact: true }).click();
    await expect(dialog.locator('iframe')).toHaveAttribute('src', /youtube-nocookie.com\/embed\/abcdefghijk/);
    await dialog.getByRole('button', { name: 'Screenshots (2)' }).click();
    await dialog.getByRole('button', { name: 'Next screenshot' }).click();
    await expect(dialog.getByText('Steam screenshot (PC footage)')).toBeVisible();
    await dialog.getByRole('button', { name: 'Alert <5€', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Could not save. Please retry.');
    await dialog.getByRole('button', { name: 'Retry action' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Saved.');
    await expect(dialog.getByRole('button', { name: 'Alert <5€' })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'Alert <5€' }).click();
    await expect(dialog.getByRole('button', { name: 'Alert <5€' })).toHaveAttribute('aria-pressed', 'false');
    for (const threshold of [2, 10]) {
      const button = dialog.getByRole('button', { name: `Alert <${threshold}€`, exact: true });
      await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
      await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'false');
    }
    await dialog.getByRole('button', { name: 'Thinking', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Remove Thinking' })).toBeVisible();
    await expect(dialog.getByRole('status')).toHaveText('Saved.');
    await dialog.getByRole('button', { name: 'Remove Thinking' }).click();
    await dialog.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Unhide', exact: true })).toBeVisible();
    expect(prefs.hiddenGames).toContain('999'); expect(prefs.watchGames['888'].threshold).toBe(10); expect(prefs.thinkingAbout).toContain('777');
    await dialog.getByRole('button', { name: 'Unhide', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
    await page.addScriptTag({ content: axe.source });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run(document)).violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical').map((issue) => issue.id))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `test-results/detail-upgrade-${viewport.width}.png` });
    await page.keyboard.press('Escape');
    const opener = page.getByRole('button', { name: `View details for ${game.title}` });
    await opener.click();
    await dialog.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Unhide', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Logout' })).toBeFocused();
  });
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
