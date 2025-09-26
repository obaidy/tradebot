import axios from 'axios';
import { CONFIG } from '../config';
import { ClientsRepository } from '../db/clientsRepo';
import { getPool } from '../db/pool';
import { logger } from '../utils/logger';
import { errorMessage, formatError } from '../utils/formatError';
import { retry } from '../utils/retry';
import { Telegram } from './telegram';

type AlertOptions = {
  message: string;
  clientId?: string;
  subject?: string;
};

async function sendEmail(to: string, subject: string, text: string) {
  if (!CONFIG.SENDGRID_API_KEY || !CONFIG.ALERT_EMAIL_FROM) return;
  await retry(
    () =>
      axios.post(
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
      ),
    {
      attempts: 3,
      delayMs: 500,
      backoffFactor: 2,
      onRetry: (error, attempt) => {
        logger.warn('email_alert_retry', {
          event: 'email_alert_retry',
          to,
          attempt,
          error: formatError(error),
        });
      },
    }
  )
    .catch((error) => {
      logger.warn('email_alert_failed', {
        event: 'email_alert_failed',
        to,
        error: formatError(error),
      });
    });
}

async function sendSms(to: string, text: string) {
  if (!CONFIG.TWILIO_ACCOUNT_SID || !CONFIG.TWILIO_AUTH_TOKEN || !CONFIG.ALERT_SMS_FROM) return;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${CONFIG.TWILIO_ACCOUNT_SID}/Messages.json`;
  const params = new URLSearchParams({
    From: CONFIG.ALERT_SMS_FROM,
    To: to,
    Body: text,
  });
  await retry(
    () =>
      axios.post(url, params, {
        auth: {
          username: CONFIG.TWILIO_ACCOUNT_SID,
          password: CONFIG.TWILIO_AUTH_TOKEN,
        },
      }),
    {
      attempts: 3,
      delayMs: 500,
      backoffFactor: 2,
      onRetry: (error, attempt) => {
        logger.warn('sms_alert_retry', {
          event: 'sms_alert_retry',
          to,
          attempt,
          error: formatError(error),
        });
      },
    }
  )
    .catch((error) => {
      logger.warn('sms_alert_failed', {
        event: 'sms_alert_failed',
        to,
        error: formatError(error),
      });
    });
}

async function loadClientContacts(clientId: string) {
  const pool = getPool();
  const clientsRepo = new ClientsRepository(pool);
  const client = await clientsRepo.findById(clientId).catch((error) => {
    logger.warn('client_contact_lookup_failed', {
      event: 'client_contact_lookup_failed',
      clientId,
      error: errorMessage(error),
    });
    return null;
  });
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
      await Telegram.sendMessage(text, contacts.telegramChatId);
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
