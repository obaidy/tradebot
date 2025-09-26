import axios from 'axios';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { formatError } from '../utils/formatError';
import { retry } from '../utils/retry';

export const Telegram = {
  async sendMessage(msg: string, chatId?: string) {
    const token = CONFIG.TELEGRAM_TOKEN;
    const targetChat = chatId || CONFIG.TELEGRAM_CHAT_ID;
    if (!token || !targetChat) return;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await retry(
      () => axios.post(url, { chat_id: targetChat, text: msg }),
      {
        attempts: 3,
        delayMs: 500,
        backoffFactor: 2,
        onRetry: (error, attempt) => {
          logger.warn('telegram_send_retry', {
            event: 'telegram_send_retry',
            attempt,
            error: formatError(error),
            chatId: targetChat,
          });
        },
      }
    ).catch((error) => {
      logger.warn('telegram_send_failed', {
        event: 'telegram_send_failed',
        error: formatError(error),
        chatId: targetChat,
      });
    });
  },
};
