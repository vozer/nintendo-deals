import { describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from './session';

describe('signed auth sessions', () => {
  it('verifies an unexpired token without embedding the password', async () => {
    const token = await createSessionToken('test-password', 1_800_000_000_000);

    expect(token).not.toContain('test-password');
    expect(await verifySessionToken(token, 'test-password', 1_800_000_000_000)).toBe(true);
    expect(await verifySessionToken(token, 'wrong-password', 1_800_000_000_000)).toBe(false);
  });

  it('rejects expired and tampered tokens', async () => {
    const now = 1_800_000_000_000;
    const token = await createSessionToken('test-password', now);
    const expiry = Number(token.split('.')[0]);

    expect(await verifySessionToken(token, 'test-password', (expiry + 1) * 1000)).toBe(false);
    expect(await verifySessionToken(`${token.slice(0, -1)}0`, 'test-password', now)).toBe(false);
  });
});
