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

let cachedBlobUrl: string | null = null;

async function getBlobUrl(): Promise<string | null> {
  if (cachedBlobUrl) return cachedBlobUrl;
  try {
    const meta = await head(PREFS_KEY, { token: getToken() });
    cachedBlobUrl = meta.url;
    return cachedBlobUrl;
  } catch {
    return null;
  }
}

export async function getPreferences(): Promise<Preferences> {
  try {
    const url = await getBlobUrl();
    if (!url) return { ...DEFAULT_PREFS };

    const res = await fetch(`${url}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });
    if (!res.ok) return { ...DEFAULT_PREFS };
    return await res.json();
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  const blob = await put(PREFS_KEY, JSON.stringify(prefs), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: getToken(),
  });
  cachedBlobUrl = blob.url;
}
