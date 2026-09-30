import { describe, expect, it } from 'vitest';
import { mediaUrl, nintendoLink, releaseDate, steamLink, translateCategory, mergeVideos } from './game-presentation';

describe('game presentation', () => {
  it('preserves valid cached playback fields during a partial refresh', () => {
    expect(mergeVideos([{ type: 'steam', video_id: '1', hls_url: 'https://video.fastly.steamstatic.com/working.m3u8' }], [{ type: 'steam', video_id: '1', name: 'Updated title', hls_url: '' }])[0]).toMatchObject({ hls_url: 'https://video.fastly.steamstatic.com/working.m3u8', name: 'Updated title' });
  });
  it('formats English metadata without mutating source categories', () => {
    expect(translateCategory('Acción')).toBe('Action');
    expect(translateCategory('unknown category')).toBe('Other');
    expect(releaseDate('30/09/2026')).toBe('30 Sept 2026');
    expect(releaseDate('not a date')).toBe('');
  });
  it('uses canonical links and rejects lookalike hosts and credentials', () => {
    expect(nintendoLink('/es-es/future-knight')).toBe('https://www.nintendo.com/es-es/future-knight');
    expect(nintendoLink('https://www.nintendo.com/es-es/game')).toBe('https://www.nintendo.com/es-es/game');
    expect(nintendoLink('https://attacker.test/path')).toBeUndefined();
    expect(steamLink(undefined, { screenshots: [], videos: [], source: 'steam', igdb_url: null, last_updated: 'today', steam_match: { steam_id: 4235410, matched_title: 'Future Knight', publisher: 'Studio', last_updated: 'today' } })).toBe('https://store.steampowered.com/app/4235410/');
    expect(mediaUrl('https://images.igdb.com.attacker.test/x')).toBe(false);
    expect(mediaUrl('https://user:password@images.igdb.com/x')).toBe(false);
  });
});
