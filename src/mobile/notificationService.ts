import { Notifier } from '../alerts/notifier';
import { logger } from '../utils/logger';
import type { ControlNotificationPayload } from './types';

export async function routeControlNotification(payload: ControlNotificationPayload): Promise<void> {
  const message = buildMessage(payload);
  const tasks = [
    Notifier.notifyOps(message),
    Notifier.notifyClient({
      clientId: payload.clientId,
      subject: 'Mobile Control Event',
      message,
    }),
  ];

  const results = await Promise.allSettled(tasks);
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger?.warn?.('mobile_control_notification_failed', {
        event: 'mobile_control_notification_failed',
        channel: index === 0 ? 'ops' : 'client',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        payload,
      });
    }
  });
}

function buildMessage(payload: ControlNotificationPayload): string {
  const base = `Control ${payload.action} triggered for client ${payload.clientId}`;
  const detailParts = [
    `Initiated by ${payload.actor}`,
    `Device ${payload.deviceId}`,
  ];
  if (payload.strategyId) {
    detailParts.push(`Strategy ${payload.strategyId}`);
  }
  if (payload.metadata?.email) {
    detailParts.push(`User ${payload.metadata.email}`);
  }
  return `${base}\n${detailParts.join(' | ')}`;
}
