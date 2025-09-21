import axios from 'axios';
import { CONFIG } from '../config';
import { ClientsRepository } from '../db/clientsRepo';
import { getPool } from '../db/pool';
import { Telegram } from './telegram';

type AlertOptions = {
  message: string;
  clientId?: string;
  subject?: string;
};

async function sendEmail(to: string, subject: string, text: string) {
  if (!CONFIG.SENDGRID_API_KEY || !CONFIG.ALERT_EMAIL_FROM) return;
  await axios
    .post(
      'https://api.sendgrid.com/v3/mail/send',
      {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: CONFIG.ALERT_EMAIL_FROM },
        subject,
        content: [{ type: 'text/plain', value: text }],
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    )
    .catch(() => {});
}

async function sendSms(to: string, text: string) {
  if (!CONFIG.TWILIO_ACCOUNT_SID || !CONFIG.TWILIO_AUTH_TOKEN || !CONFIG.ALERT_SMS_FROM) return;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${CONFIG.TWILIO_ACCOUNT_SID}/Messages.json`;
  const params = new URLSearchParams({
    From: CONFIG.ALERT_SMS_FROM,
    To: to,
    Body: text,
  });
  await axios
    .post(url, params, {
      auth: {
        username: CONFIG.TWILIO_ACCOUNT_SID,
        password: CONFIG.TWILIO_AUTH_TOKEN,
      },
    })
    .catch(() => {});
}

async function loadClientContacts(clientId: string) {
  const pool = getPool();
  const clientsRepo = new ClientsRepository(pool);
  const client = await clientsRepo.findById(clientId).catch(() => null);
  if (!client) return { email: null, phone: null, telegramChatId: null };
  const contact = (client.contactInfo ?? {}) as Record<string, any>;
  return {
    email: (contact.email ?? contact.billingEmail ?? null) as string | null,
    phone: (contact.phone ?? contact.sms ?? null) as string | null,
    telegramChatId: (contact.telegramChatId ?? contact.telegram_chat_id ?? null) as string | null,
  };
}

export const Notifier = {
  async notifyOps(message: string) {
    await Telegram.sendMessage(message);
  },

  async notifyClient(options: AlertOptions) {
    const subject = options.subject ?? 'TradeBot Alert';
    const text = options.message;
    if (!options.clientId) {
      await Telegram.sendMessage(text);
      return;
    }
    const contacts = await loadClientContacts(options.clientId);
    if (contacts.telegramChatId) {
      await Telegram.sendMessage(text, contacts.telegramChatId).catch(() => {});
    }
    if (contacts.email) {
      await sendEmail(contacts.email, subject, text);
    }
    if (contacts.phone) {
      await sendSms(contacts.phone, text);
    }
    if (!contacts.telegramChatId && !contacts.email && !contacts.phone) {
      await Telegram.sendMessage(text);
    }
  },
};
