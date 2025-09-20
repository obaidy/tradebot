import axios from 'axios';
import { CONFIG } from '../config';

export const Telegram = {
  async sendMessage(msg: string) {
    if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`;
    await axios.post(url, { chat_id: CONFIG.TELEGRAM_CHAT_ID, text: msg });
  }
};
