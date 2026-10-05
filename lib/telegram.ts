import { timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { appendTelegramAuditEvent } from './telegram-audit-storage';

export type TelegramAction =
  | { action: 'hide'; fs_id: string }
  | { action: 'watch'; fs_id: string; threshold: 2 | 5 | 10 };

export function parseTelegramCallback(data: unknown): TelegramAction | null {
  if (typeof data !== 'string') return null;

  const parts = data.split(':');
  if (parts.length === 3 && parts[0] === 'nd' && parts[1] === 'hide' && /^\d+$/.test(parts[2])) {
    return { action: 'hide', fs_id: parts[2] };
  }

  if (
    parts.length === 4 &&
    parts[0] === 'nd' &&
    parts[1] === 'watch' &&
    /^\d+$/.test(parts[2]) &&
    [2, 5, 10].includes(Number(parts[2])) &&
    /^\d+$/.test(parts[3])
  ) {
    return { action: 'watch', threshold: Number(parts[2]) as 2 | 5 | 10, fs_id: parts[3] };
  }

  return null;
}

export function isTelegramSecretValid(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function isTelegramActorAllowed(chatId: unknown, userId: unknown): boolean {
  const allowedChatId = process.env.NINTENDO_TELEGRAM_CHAT_ID?.trim();
  const allowedUserId = process.env.NINTENDO_TELEGRAM_USER_ID?.trim();
  if (!allowedChatId || String(chatId) !== allowedChatId) return false;
  return !allowedUserId || String(userId) === allowedUserId;
}

export function buildDigestKeyboard(fsId: string, baseUrl: string) {
  const id = encodeURIComponent(fsId);
  const url = `${baseUrl.replace(/\/$/, '')}/?game=${id}`;
  return {
    inline_keyboard: [
      [
        { text: 'Show', url },
        { text: 'Hide', callback_data: `nd:hide:${fsId}` },
      ],
      [2, 5, 10].map((threshold) => ({
        text: `Alert ${threshold}€`,
        callback_data: `nd:watch:${threshold}:${fsId}`,
      })),
    ],
  };
}

export function updateDigestStatus(
  text: string,
  game: { hidden: boolean; watch: { threshold: 2 | 5 | 10 } | null },
): string {
  const alert = game.watch ? `under ${game.watch.threshold}€` : 'none';
  const status = `Status: Hidden ${game.hidden ? 'Yes' : 'No'}; Alert: ${alert}`;
  return /^Status:.*$/m.test(text) ? text.replace(/^Status:.*$/m, status) : `${text}\n${status}`;
}

export async function telegramRequest(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
  context: { source?: string; correlation_id?: string } = {},
): Promise<Record<string, unknown>> {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();
  const auditContext = { source: context.source || 'vercel_webhook', ...context };
  await appendTelegramAuditEvent({
    event_id: `telegram-request:${requestId}:attempt`, occurred_at: timestamp, direction: 'outbound',
    kind: 'telegram.request.attempt', correlation_id: context.correlation_id,
    request: { ...auditContext, method, payload },
  });

  let responseStatus: number | null = null;
  let data: Record<string, unknown>;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    responseStatus = response.status;
    data = await response.json() as Record<string, unknown>;
  } catch (error) {
    await appendTelegramAuditEvent({
      event_id: `telegram-request:${requestId}:result`, occurred_at: new Date().toISOString(), direction: 'outbound',
      kind: 'telegram.request.result', correlation_id: context.correlation_id,
      response: { outcome: 'unknown', http_status: responseStatus, error: error instanceof Error ? error.message : 'NetworkError' },
    });
    throw error;
  }

  const isNotModified = typeof data.description === 'string' && data.description.toLowerCase().includes('message is not modified');
  await appendTelegramAuditEvent({
    event_id: `telegram-request:${requestId}:result`, occurred_at: new Date().toISOString(), direction: 'outbound',
    kind: 'telegram.request.result', correlation_id: context.correlation_id,
    response: { outcome: responseStatus < 300 && data.ok === true || isNotModified ? 'sent' : 'rejected',
      http_status: responseStatus, body: data },
  });
  if (
    ['editMessageText', 'editMessageCaption'].includes(method) &&
    isNotModified
  ) {
    return data;
  }
  if (!responseStatus || responseStatus >= 300 || data.ok !== true) {
    throw new Error(`Telegram ${method} failed with HTTP ${responseStatus ?? 'unknown'}`);
  }
  return data;
}
