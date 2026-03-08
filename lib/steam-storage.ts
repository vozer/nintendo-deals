import { put, get as blobGet } from '@vercel/blob';
import { SteamRatingsMap } from './types';

const STEAM_KEY = 'steam_ratings.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

export async function getSteamRatings(): Promise<SteamRatingsMap> {
  try {
    const token = getToken();
    const result = await blobGet(STEAM_KEY, { access: 'private', token });
    if (!result || result.statusCode !== 200) return {};
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as SteamRatingsMap;
  } catch {
    return {};
  }
}

export async function saveSteamRatings(ratings: SteamRatingsMap): Promise<void> {
  await put(STEAM_KEY, JSON.stringify(ratings), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: getToken(),
  });
}
