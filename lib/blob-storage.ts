import { put, get as blobGet } from '@vercel/blob';
import { Preferences } from './types';

const PREFS_KEY = 'preferences.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

const DEFAULT_PREFS: Preferences = {
  hiddenGames: [],
  watchGames: {},
  thinkingAbout: [],
};

export async function getPreferences(): Promise<Preferences> {
  try {
    const token = getToken();
    const result = await blobGet(PREFS_KEY, { access: 'private', token });
    if (!result || result.statusCode !== 200) return { ...DEFAULT_PREFS };
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as Preferences;
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
