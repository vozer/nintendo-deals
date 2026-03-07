import { put, head } from '@vercel/blob';
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
    const token = getToken();
    const meta = await head(PREFS_KEY, { token });
    if (!meta) return { ...DEFAULT_PREFS };

    const res = await fetch(`${meta.url}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ...DEFAULT_PREFS };
    return await res.json();
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await put(PREFS_KEY, JSON.stringify(prefs), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: getToken(),
  });
}
