import { timingSafeEqual } from 'node:crypto';

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
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json() as Record<string, unknown>;
  if (
    ['editMessageText', 'editMessageCaption'].includes(method) &&
    typeof data.description === 'string' &&
    data.description.toLowerCase().includes('message is not modified')
  ) {
    return data;
  }
  if (!response.ok || data.ok !== true) {
    throw new Error(`Telegram ${method} failed with HTTP ${response.status}`);
  }
  return data;
}
