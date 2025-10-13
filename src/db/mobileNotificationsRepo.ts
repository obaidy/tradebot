import { Pool } from 'pg';
import type { ControlNotificationPayload } from '../mobile/types';

export class MobileControlNotificationsRepository {
  constructor(private readonly pool: Pool) {}

  async record(payload: ControlNotificationPayload): Promise<void> {
    await this.pool.query(
      `INSERT INTO mobile_control_notifications (client_id, action, actor, device_id, strategy_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        payload.clientId,
        payload.action,
        payload.actor,
        payload.deviceId,
        payload.strategyId ?? null,
        payload.metadata ?? null,
      ]
    );
  }
}
