// Telegram bot service for 2FA.
//
// Boot:
//   - If TELEGRAM_BOT_TOKEN is unset, returns a stub service with ready=false.
//     Auth still works (login just skips 2FA for users without telegramChatId).
//   - If set, starts polling and registers /start handler.
//
// User flow:
//   1. User registers via /api/auth/register → receives linkToken.
//   2. User opens https://t.me/<botUsername> and sends `/start <linkToken>`.
//   3. Bot finds the user with that token, saves chat_id, clears the token.
//   4. Subsequent logins receive a 6-digit code via DM.
//
// Lib: node-telegram-bot-api (long-polling, no webhook needed for MVP).

import TelegramBot from 'node-telegram-bot-api';
import { User } from '../db/models/index.js';

export async function initTelegramService(app) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    app.log.warn('TELEGRAM_BOT_TOKEN not set — 2FA will be skipped for new users.');
    return { ready: false, botUsername: null, sendCode: noopSend };
  }

  let bot, info;
  try {
    bot = new TelegramBot(token, { polling: true });
    info = await bot.getMe();
  } catch (err) {
    app.log.error({ err: err.message }, 'Telegram bot init failed — 2FA disabled.');
    return { ready: false, botUsername: null, sendCode: noopSend };
  }
  app.log.info(`[tg] bot online — @${info.username}`);

  bot.onText(/^\/start(?:\s+([a-f0-9]{8,64}))?$/i, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const linkToken = match?.[1];
    if (!linkToken) {
      return bot.sendMessage(chatId,
        `👋 Kick-Off FM — бот двофакторної автентифікації.\n\nЩоб привʼязати акаунт:\n1. Зареєструйся на сайті\n2. Скопіюй токен привʼязки, що зʼявиться\n3. Надішли сюди: /start <токен>\n\nПісля цього бот надсилатиме сюди 6-значні коди на кожен вхід.`);
    }
    if (!app.dbReady) {
      return bot.sendMessage(chatId, '⚠️ Сервер тимчасово недоступний. Спробуй через хвилину.');
    }
    const user = await User.findOne({ telegramLinkToken: linkToken });
    if (!user) {
      return bot.sendMessage(chatId, '❌ Токен не знайдено або вже використано. Зареєструйся знову на сайті.');
    }
    if (user.telegramLinkExpires && user.telegramLinkExpires < new Date()) {
      return bot.sendMessage(chatId, '⏱ Токен прострочений. Зареєструйся знову.');
    }
    if (user.telegramChatId && user.telegramChatId !== chatId) {
      return bot.sendMessage(chatId, '⚠️ Цей акаунт уже привʼязано до іншого Telegram. Звернись до адміна.');
    }
    user.telegramChatId = chatId;
    user.telegramLinkToken = null;
    user.telegramLinkExpires = null;
    await user.save();
    app.log.info({ userId: user._id.toString(), chatId }, '[tg] user linked');
    return bot.sendMessage(chatId,
      `✅ Привʼязано до *${escMd(user.username)}*\\. На наступному вході надішлю 6\\-значний код сюди\\.`,
      { parse_mode: 'MarkdownV2' });
  });

  bot.on('polling_error', (err) => {
    app.log.warn({ err: err.message }, '[tg] polling error');
  });

  return {
    ready: true,
    botUsername: info.username,
    async sendCode(chatId, code) {
      await bot.sendMessage(chatId,
        `🔐 Код входу Kick\\-Off FM: *${escMd(code)}*\n_Дійсний 5 хвилин\\._`,
        { parse_mode: 'MarkdownV2' });
    },
  };
}

function escMd(s) {
  // Escape MarkdownV2 reserved chars
  return String(s).replace(/[_*[\]()~`>#+=\-|{}.!\\]/g, (c) => '\\' + c);
}

async function noopSend() {
  throw new Error('telegram_not_configured');
}
