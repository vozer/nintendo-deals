import { get as blobGet, put, BlobPreconditionFailedError } from '@vercel/blob';
import { createHash } from 'node:crypto';

export class SnapshotConflictError extends Error {}

export function snapshotRevision(value: object): string {
  return `"${createHash('sha256').update(JSON.stringify(value)).digest('hex')}"`;
}

export async function updatePrivateJsonMap<T>(key: string, updates: Record<string, T>, token: string | undefined, expectedRevision?: string, merge: (previous: T | undefined, next: T) => T = (_previous, next) => next): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await blobGet(key, { access: 'private', token, useCache: false, headers: { 'Accept-Encoding': 'identity' } });
    if (result && result.statusCode !== 200) throw new Error(`Unexpected ${key} blob response`);
    const current = result ? JSON.parse(await new Response(result.stream).text()) : {};
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error(`Invalid ${key} document`);
    if (expectedRevision && snapshotRevision(current) !== expectedRevision) throw new SnapshotConflictError('Snapshot changed; read and stage again');
    const next = { ...current };
    for (const [id, entry] of Object.entries(updates)) next[id] = merge(current[id], entry);
    try {
      await put(key, JSON.stringify(next), {
        access: 'private', token, contentType: 'application/json', addRandomSuffix: false,
        allowOverwrite: !!result, cacheControlMaxAge: 0, ...(result ? { ifMatch: result.blob.etag } : {}),
      });
      return;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || (error instanceof Error && error.name === 'BlobPreconditionFailedError')) continue;
      if (!result && await blobGet(key, { access: 'private', token, useCache: false })) continue;
      throw error;
    }
  }
  throw new SnapshotConflictError('Snapshot changed too frequently; retry');
}

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
