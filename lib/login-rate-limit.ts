const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_CLIENTS = 1000;
// ponytail: per-instance limiter; use shared storage if cross-instance abuse appears.
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginAttempt(client: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
  for (const [key, bucket] of attempts) {
    if (bucket.resetAt <= now) attempts.delete(key);
  }
  let bucket = attempts.get(client);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    attempts.set(client, bucket);
  }
  if (bucket.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  if (attempts.size > MAX_CLIENTS) attempts.delete(attempts.keys().next().value!);
  return { allowed: true, retryAfter: 0 };
}

export function clearLoginAttempts(client: string): void {
  attempts.delete(client);
}
