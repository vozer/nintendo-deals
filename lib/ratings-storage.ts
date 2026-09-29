import { put } from '@vercel/blob';
import { RatingsMap } from './types';
import { readPrivateJsonMap } from './blob-json';

const RATINGS_KEY = 'ratings.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

export async function getRatings(): Promise<RatingsMap> {
  return readPrivateJsonMap<RatingsMap>(RATINGS_KEY, getToken());
}

export async function saveRatings(ratings: RatingsMap): Promise<void> {
  await put(RATINGS_KEY, JSON.stringify(ratings), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: getToken(),
  });
}
