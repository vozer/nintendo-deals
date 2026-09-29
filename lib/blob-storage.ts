import { BlobPreconditionFailedError, put, get as blobGet } from '@vercel/blob';
import { Preferences } from './types';

const PREFS_KEY = 'preferences.json';
const VALID_THRESHOLDS = new Set([2, 5, 10]);
const GAME_ID_PATTERN = /^\d+$/;
const MAX_WRITE_ATTEMPTS = 5;
const MAX_TELEGRAM_REPLAY_IDS = 1000;
const MAX_DELIVERY_DAYS = 35;

type StoredState = {
  preferences: Preferences;
  processedTelegramUpdateIds: string[];
  deliveryKeysByDate: Record<string, string[]>;
  etag: string | null;
};

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

function isPreferencesShape(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return Array.isArray(source.hiddenGames)
    && !!source.watchGames
    && typeof source.watchGames === 'object'
    && !Array.isArray(source.watchGames)
    && Array.isArray(source.thinkingAbout);
}

function validReplayIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200)
    .slice(-MAX_TELEGRAM_REPLAY_IDS);
}

function validDeliveryKeys(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [date, keys] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(keys)) continue;
    result[date] = keys.filter(
      (key): key is string => typeof key === 'string' && /^[a-z0-9:_-]{1,120}$/i.test(key),
    );
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)).slice(-MAX_DELIVERY_DAYS),
  );
}

async function readState(): Promise<StoredState> {
  const result = await blobGet(PREFS_KEY, {
    access: 'private',
    token: getToken(),
    useCache: false,
  });
  if (!result) {
    return {
      preferences: cloneDefaultPreferences(),
      processedTelegramUpdateIds: [],
      deliveryKeysByDate: {},
      etag: null,
    };
  }
  if (result.statusCode !== 200) throw new Error('Unexpected preferences blob response');

  const stored = JSON.parse(await new Response(result.stream).text()) as unknown;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error('Invalid preferences document');
  }

  const source = stored as Record<string, unknown>;
  const isVersioned = source.version === 1 && 'preferences' in source;
  const rawPreferences = isVersioned ? source.preferences : stored;
  if (!isPreferencesShape(rawPreferences)) throw new Error('Invalid preferences document');

  const telegram = isVersioned && source.telegram && typeof source.telegram === 'object'
    ? source.telegram as Record<string, unknown>
    : {};

  return {
    preferences: normalizePreferences(rawPreferences),
    processedTelegramUpdateIds: validReplayIds(telegram.processedUpdateIds),
    deliveryKeysByDate: validDeliveryKeys(telegram.deliveryKeysByDate),
    etag: result.blob.etag,
  };
}

export async function getPreferences(): Promise<Preferences> {
  return (await readState()).preferences;
}

export const getPreferencesStrict = getPreferences;

type PreferencesUpdate = (
  current: Preferences,
) => Preferences | Promise<Preferences>;

async function commitState(
  state: StoredState,
  preferences: Preferences,
  processedTelegramUpdateIds: string[],
  deliveryKeysByDate: Record<string, string[]>,
): Promise<boolean> {
  try {
    await put(PREFS_KEY, JSON.stringify({
      version: 1,
      preferences,
      telegram: { processedUpdateIds: processedTelegramUpdateIds, deliveryKeysByDate },
    }), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: state.etag !== null,
      cacheControlMaxAge: 0,
      token: getToken(),
      ...(state.etag ? { ifMatch: state.etag } : {}),
    });
    return true;
  } catch (error) {
    const preconditionFailed = error instanceof BlobPreconditionFailedError ||
      (error instanceof Error && error.name === 'BlobPreconditionFailedError');
    if (state.etag && preconditionFailed) return false;
    if (!state.etag && (await readState()).etag) return false;
    throw error;
  }
}

export async function updatePreferencesAtomically(
  update: PreferencesUpdate,
  telegramUpdateId?: string,
): Promise<{ preferences: Preferences; duplicate: boolean }> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const state = await readState();
    if (telegramUpdateId && state.processedTelegramUpdateIds.includes(telegramUpdateId)) {
      return { preferences: state.preferences, duplicate: true };
    }

    const preferences = normalizePreferences(await update(state.preferences));
    if (!telegramUpdateId && JSON.stringify(preferences) === JSON.stringify(state.preferences)) {
      return { preferences, duplicate: false };
    }
    const replayIds = telegramUpdateId
      ? [...state.processedTelegramUpdateIds, telegramUpdateId].slice(-MAX_TELEGRAM_REPLAY_IDS)
      : state.processedTelegramUpdateIds;

    if (await commitState(state, preferences, replayIds, state.deliveryKeysByDate)) {
      return { preferences, duplicate: false };
    }
  }

  throw new Error('Preferences changed too frequently; retry the action');
}

export async function claimDailyDelivery(date: string, key: string): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-z0-9:_-]{1,120}$/i.test(key)) {
    throw new Error('Invalid daily delivery key');
  }

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const state = await readState();
    const existing = state.deliveryKeysByDate[date] || [];
    if (existing.includes(key)) return false;

    const deliveryKeysByDate = validDeliveryKeys({
      ...state.deliveryKeysByDate,
      [date]: [...existing, key],
    });
    if (await commitState(
      state,
      state.preferences,
      state.processedTelegramUpdateIds,
      deliveryKeysByDate,
    )) return true;
  }

  throw new Error('Daily delivery state changed too frequently; retry the claim');
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await updatePreferencesAtomically(() => prefs);
}
