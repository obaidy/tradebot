import axios from 'axios';
import { CONFIG } from '../config';

export const Telegram = {
  async sendMessage(msg: string, chatId?: string) {
    const token = CONFIG.TELEGRAM_TOKEN;
    const targetChat = chatId || CONFIG.TELEGRAM_CHAT_ID;
    if (!token || !targetChat) return;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await axios.post(url, { chat_id: targetChat, text: msg }).catch(() => {});
  },
};
