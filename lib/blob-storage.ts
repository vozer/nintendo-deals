import { put, list } from '@vercel/blob';
import { Preferences } from './types';

const PREFS_KEY = 'preferences.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

const DEFAULT_PREFS: Preferences = {
  hiddenGames: [],
  watchGames: {},
};

export async function getPreferences(): Promise<Preferences> {
  try {
    const { blobs } = await list({ prefix: PREFS_KEY, limit: 1, token: getToken() });
    if (blobs.length === 0) return { ...DEFAULT_PREFS };
    const res = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!res.ok) return { ...DEFAULT_PREFS };
    return await res.json();
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await put(PREFS_KEY, JSON.stringify(prefs), {
    access: 'public',
    addRandomSuffix: false,
    token: getToken(),
  });
}
