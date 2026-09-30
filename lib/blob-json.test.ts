import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ data: { '1': { title: 'Retained' } } as Record<string, unknown>, revision: 1, conflict: false }));
vi.mock('@vercel/blob', () => ({
  BlobPreconditionFailedError: class BlobPreconditionFailedError extends Error {},
  get: async () => ({ statusCode: 200, blob: { etag: String(store.revision) }, stream: new Response(JSON.stringify(store.data)).body }),
  put: async (_key: string, body: string, options: { ifMatch: string }) => {
    if (store.conflict) {
      store.conflict = false;
      store.data['2'] = { title: 'Concurrent' };
      store.revision++;
      const error = new Error('conflict'); error.name = 'BlobPreconditionFailedError'; throw error;
    }
    if (options.ifMatch !== String(store.revision)) throw new Error('Missing conditional revision');
    store.data = JSON.parse(body); store.revision++;
  },
}));
import { snapshotRevision, updatePrivateJsonMap } from './blob-json';

beforeEach(() => { store.data = { '1': { title: 'Retained' } }; store.revision = 1; store.conflict = false; });
describe('conditional enrichment publication', () => {
  it('preserves unrelated entries while retrying a conflicting Blob write', async () => {
    store.conflict = true;
    await updatePrivateJsonMap('media.json', { '3': { title: 'Added' } }, 'synthetic');
    expect(store.data).toEqual({ '1': { title: 'Retained' }, '2': { title: 'Concurrent' }, '3': { title: 'Added' } });
  });
  it('rejects stale staged data instead of overwriting concurrent enrichment', async () => {
    const revision = snapshotRevision(store.data);
    store.conflict = true;
    await expect(updatePrivateJsonMap('media.json', { '3': { title: 'Added' } }, 'synthetic', revision)).rejects.toThrow('Snapshot changed');
    expect(store.data['3']).toBeUndefined();
    expect(store.data['2']).toEqual({ title: 'Concurrent' });
  });
});
