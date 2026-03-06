import { put, head, get as blobGet } from '@vercel/blob';
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

    const result = await blobGet(meta.url, { token, access: 'private' });
    if (!result) return { ...DEFAULT_PREFS };

    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await put(PREFS_KEY, JSON.stringify(prefs), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: getToken(),
  });
}
