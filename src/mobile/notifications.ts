import { routeControlNotification } from './notificationService';
import type { ControlNotificationPayload } from './types';
import type { MobileControlNotificationsRepository } from '../db/mobileNotificationsRepo';
import { logger } from '../utils/logger';

export async function dispatchControlNotification(
  repo: MobileControlNotificationsRepository,
  payload: ControlNotificationPayload
): Promise<void> {
  await routeControlNotification(payload);
  try {
    await repo.record(payload);
  } catch (error) {
    logger?.warn?.('mobile_control_notification_record_failed', {
      event: 'mobile_control_notification_record_failed',
      error: error instanceof Error ? error.message : String(error),
      payload,
    });
  }
}
