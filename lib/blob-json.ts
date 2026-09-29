import { get as blobGet } from '@vercel/blob';

export async function readPrivateJsonMap<T extends object>(key: string, token?: string): Promise<T> {
  const result = await blobGet(key, { access: 'private', token, useCache: false });
  if (!result) return {} as T;
  if (result.statusCode !== 200) throw new Error(`Unexpected ${key} blob response`);
  const value: unknown = JSON.parse(await new Response(result.stream).text());
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${key} document`);
  }
  return value as T;
}
