import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  raw: null as string | null,
  revision: 0,
  writes: 0,
  events: [] as string[],
  failWrites: false,
  failEdits: 0,
}));

vi.mock('@vercel/blob', () => ({
  get: async () => {
    if (state.raw === null) return null;
    return {
      statusCode: 200,
      stream: new Response(state.raw).body,
      blob: { etag: String(state.revision) },
    };
  },
  put: async (_pathname: string, body: string, options: Record<string, unknown>) => {
    if (state.failWrites) throw new Error('synthetic blob write failure');
    if (options.ifMatch && options.ifMatch !== String(state.revision)) {
      const error = new Error('precondition failed');
      error.name = 'BlobPreconditionFailedError';
      throw error;
    }
    if (!options.ifMatch && state.raw !== null && options.allowOverwrite !== true) {
      throw new Error('blob already exists');
    }
    state.raw = body;
    state.revision += 1;
    state.writes += 1;
    state.events.push('persist');
  },
  BlobPreconditionFailedError: class BlobPreconditionFailedError extends Error {},
}));

import { POST } from './route';

function callbackRequest(options: { secret?: string; chatId?: number; userId?: number; photo?: boolean } = {}) {
  return new NextRequest('https://nintendo-deals.test/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': options.secret ?? 'test-webhook-secret',
    },
    body: JSON.stringify({
      callback_query: {
        id: 'callback-unique-1',
        data: 'nd:hide:1001',
        from: { id: options.userId ?? 77 },
        message: {
          message_id: 9,
          ...(options.photo ? { caption: 'Adventure & puzzles\nStatus: Hidden No; Alert: none', reply_markup: { inline_keyboard: [[{ text: 'Nintendo', url: 'https://www.nintendo.com/game' }]] } } : { text: '<b>Example game</b>' }),
          chat: { id: options.chatId ?? 88 },
        },
      },
    }),
  });
}

beforeEach(() => {
  state.raw = null;
  state.revision = 0;
  state.writes = 0;
  state.events = [];
  state.failWrites = false;
  state.failEdits = 0;
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  process.env.NINTENDO_TELEGRAM_CHAT_ID = '88';
  process.env.NINTENDO_TELEGRAM_USER_ID = '77';
});

afterEach(() => vi.restoreAllMocks());

describe('Telegram callback webhook', () => {
  it('edits photo captions and preserves source buttons after persisting', async () => {
    const telegram = stubTelegram();
    const response = await POST(callbackRequest({ photo: true }));
    expect(response.status).toBe(200);
    const [url, request] = telegram.mock.calls[1];
    expect(String(url)).toContain('/editMessageCaption');
    const payload = JSON.parse(String(request?.body));
    expect(payload.caption).toContain('Status: Hidden Yes; Alert: none');
    expect(payload.caption).toContain('Adventure &amp; puzzles');
    expect(payload.reply_markup.inline_keyboard[0][0].text).toBe('Nintendo');
    expect(state.events[0]).toBe('persist');
  });
  function stubTelegram() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      const isAck = url.includes('/answerCallbackQuery');
      state.events.push(isAck ? 'ack' : 'edit');
      if (!isAck && state.failEdits > 0) {
        state.failEdits -= 1;
        return Response.json({ ok: false, description: 'synthetic edit failure' }, { status: 500 });
      }
      return Response.json({ ok: true, result: {} });
    });
  }

  it('rejects an invalid webhook secret and an unexpected chat/user', async () => {
    const telegram = stubTelegram();
    const invalidSecret = await POST(callbackRequest({ secret: 'wrong-secret' }));
    const unexpectedActor = await POST(callbackRequest({ chatId: 99, userId: 100 }));

    expect(invalidSecret.status).toBe(401);
    expect(unexpectedActor.status).toBe(200);
    expect(await unexpectedActor.json()).toEqual({ ok: false, error: 'Forbidden' });
    expect(state.writes).toBe(0);
    expect(telegram).toHaveBeenCalledTimes(1);
  });

  it('persists before acknowledgment and applies duplicate callback updates once', async () => {
    stubTelegram();

    const first = await POST(callbackRequest());
    const replay = await POST(callbackRequest());

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(state.events.indexOf('persist')).toBeLessThan(state.events.indexOf('ack'));
    expect(state.writes).toBe(1);
    const document = JSON.parse(state.raw!);
    expect(document.preferences.hiddenGames).toEqual(['1001']);
    expect(document.telegram.processedUpdateIds).toEqual(['callback-unique-1']);
  });

  it('does not acknowledge when preference persistence fails', async () => {
    state.failWrites = true;
    const telegram = stubTelegram();

    const response = await POST(callbackRequest());

    expect(response.status).toBe(500);
    expect(telegram).not.toHaveBeenCalled();
  });

  it('retries a failed Telegram edit without applying the preference twice', async () => {
    stubTelegram();
    state.failEdits = 1;

    const failedEdit = await POST(callbackRequest());
    const replay = await POST(callbackRequest());

    expect(failedEdit.status).toBe(500);
    expect(replay.status).toBe(200);
    expect(state.writes).toBe(1);
    expect(JSON.parse(state.raw!).preferences.hiddenGames).toEqual(['1001']);
  });
});
