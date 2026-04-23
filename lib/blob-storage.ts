import { put, get as blobGet } from '@vercel/blob';
import { Preferences } from './types';

const PREFS_KEY = 'preferences.json';
const VALID_THRESHOLDS = new Set([2, 5, 10]);
const GAME_ID_PATTERN = /^\d+$/;

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

function cloneDefaultPreferences(): Preferences {
  return {
    hiddenGames: [],
    watchGames: {},
    thinkingAbout: [],
  };
}

function normalizeGameId(value: unknown): string | null {
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'number'
        ? String(value)
        : '';
  const trimmed = raw.trim();
  if (!GAME_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function normalizeGameIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeGameId(item);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

function normalizeWatchGames(value: unknown): Preferences['watchGames'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const watchGames: Preferences['watchGames'] = {};

  for (const [rawId, rawEntry] of Object.entries(value as Record<string, unknown>)) {
    const fsId = normalizeGameId(rawId);
    if (!fsId) continue;
    if (!rawEntry || typeof rawEntry !== 'object') continue;

    const entry = rawEntry as Record<string, unknown>;
    const thresholdRaw = typeof entry.threshold === 'number'
      ? entry.threshold
      : Number(entry.threshold);
    if (!VALID_THRESHOLDS.has(thresholdRaw)) continue;

    const title =
      typeof entry.title === 'string' && entry.title.trim().length > 0
        ? entry.title.trim()
        : fsId;

    watchGames[fsId] = {
      threshold: thresholdRaw as 2 | 5 | 10,
      title,
    };
  }

  return watchGames;
}

export function normalizePreferences(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return cloneDefaultPreferences();
  }

  const source = raw as Record<string, unknown>;
  return {
    hiddenGames: normalizeGameIdList(source.hiddenGames),
    watchGames: normalizeWatchGames(source.watchGames),
    thinkingAbout: normalizeGameIdList(source.thinkingAbout),
  };
}

async function readPreferences(strict: boolean): Promise<Preferences> {
  try {
    const token = getToken();
    const result = await blobGet(PREFS_KEY, { access: 'private', token });
    if (!result || result.statusCode !== 200) return cloneDefaultPreferences();
    const text = await new Response(result.stream).text();
    return normalizePreferences(JSON.parse(text));
  } catch (error) {
    if (strict) throw error;
    return cloneDefaultPreferences();
  }
}

export async function getPreferences(): Promise<Preferences> {
  return readPreferences(false);
}

export async function getPreferencesStrict(): Promise<Preferences> {
  return readPreferences(true);
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await put(PREFS_KEY, JSON.stringify(normalizePreferences(prefs)), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: getToken(),
  });
}
