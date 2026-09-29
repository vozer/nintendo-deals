import { put } from '@vercel/blob';
import { SteamRatingsMap } from './types';
import { readPrivateJsonMap } from './blob-json';

const STEAM_KEY = 'steam_ratings.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

export async function getSteamRatings(): Promise<SteamRatingsMap> {
  return readPrivateJsonMap<SteamRatingsMap>(STEAM_KEY, getToken());
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
