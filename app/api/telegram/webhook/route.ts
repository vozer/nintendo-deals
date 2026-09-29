import { NextRequest, NextResponse } from 'next/server';
import {
  buildDigestKeyboard,
  isTelegramActorAllowed,
  isTelegramSecretValid,
  parseTelegramCallback,
  telegramRequest,
  updateDigestStatus,
} from '@/lib/telegram';
import { applyPreferencesAction } from '@/lib/preferences-actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function POST(req: NextRequest) {
  if (!isTelegramSecretValid(
    req.headers.get('x-telegram-bot-api-secret-token'),
    process.env.TELEGRAM_WEBHOOK_SECRET,
  )) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const update = await req.json();
    const callback = update?.callback_query;
    if (!callback) return NextResponse.json({ ok: true, ignored: true });

    const botToken = requiredEnv('TELEGRAM_BOT_TOKEN');
    const message = callback.message;
    const chatId = message?.chat?.id;
    const userId = callback.from?.id;
    if (!isTelegramActorAllowed(chatId, userId)) {
      await telegramRequest(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Not authorized',
        show_alert: true,
      });
      return NextResponse.json({ ok: false, error: 'Forbidden' });
    }

    const action = parseTelegramCallback(callback.data);
    if (!action || typeof callback.id !== 'string' || !callback.id) {
      await telegramRequest(botToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Unsupported action',
        show_alert: true,
      });
      return NextResponse.json({ ok: false, error: 'Invalid callback' });
    }

    const result = await applyPreferencesAction(action, callback.id);

    await telegramRequest(botToken, 'answerCallbackQuery', {
      callback_query_id: callback.id,
      text: result.changed
        ? action.action === 'hide' ? 'Game hidden' : `Alert set under ${action.threshold}€`
        : action.action === 'hide' ? 'Game is already hidden' : `Alert is already set under ${action.threshold}€`,
    });

    if (typeof message?.message_id !== 'number' || typeof message?.text !== 'string') {
      return NextResponse.json({ ok: true, changed: result.changed });
    }

    const baseUrl = process.env.NINTENDO_DEALS_BASE_URL || new URL(req.url).origin;
    await telegramRequest(botToken, 'editMessageText', {
      chat_id: chatId,
      message_id: message.message_id,
      text: updateDigestStatus(message.text, result.game),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: buildDigestKeyboard(action.fs_id, baseUrl),
    });

    return NextResponse.json({ ok: true, changed: result.changed, game: result.game });
  } catch (error) {
    console.error('Telegram webhook failed:', error);
    return NextResponse.json({ error: 'Failed to process Telegram callback' }, { status: 500 });
  }
}
