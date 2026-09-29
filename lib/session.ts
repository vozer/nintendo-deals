const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();

async function signingKey(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

function sessionMessage(expiresAt: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(`nintendo-deals-auth:v1:${expiresAt}`));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return new Uint8Array(Uint8Array.from(value.match(/.{2}/g)!, (byte) => Number.parseInt(byte, 16)));
}

export async function createSessionToken(password: string, now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + MAX_AGE_SECONDS;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(password), sessionMessage(expiresAt));
  return `${expiresAt}.${toHex(new Uint8Array(signature))}`;
}

export async function verifySessionToken(
  token: string | undefined,
  password: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token || !password) return false;
  const [rawExpiry, rawSignature, extra] = token.split('.');
  if (extra !== undefined || !/^\d{1,12}$/.test(rawExpiry)) return false;
  const expiresAt = Number(rawExpiry);
  const nowSeconds = Math.floor(now / 1000);
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + MAX_AGE_SECONDS) return false;
  const signature = fromHex(rawSignature);
  if (!signature) return false;
  return crypto.subtle.verify('HMAC', await signingKey(password), signature, sessionMessage(expiresAt));
}
