import { put, head } from '@vercel/blob';
import { RatingsMap } from './types';

const RATINGS_KEY = 'ratings.json';

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.nintendo_READ_WRITE_TOKEN;
}

export async function getRatings(): Promise<RatingsMap> {
  try {
    const token = getToken();
    const meta = await head(RATINGS_KEY, { token });
    if (!meta) return {};

    const res = await fetch(`${meta.url}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
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
