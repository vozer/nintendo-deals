import { SteamRatingsMap } from './types';
import { readPrivateJsonMap, updatePrivateJsonMap } from './blob-json';

const STEAM_KEY = 'steam_ratings.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

export async function getSteamRatings(): Promise<SteamRatingsMap> {
  return readPrivateJsonMap<SteamRatingsMap>(STEAM_KEY, getToken());
}

export async function saveSteamRatings(ratings: SteamRatingsMap, revision?: string): Promise<void> {
  await updatePrivateJsonMap(STEAM_KEY, ratings, getToken(), revision, (old, next) => ({ ...old, ...next }));
}
