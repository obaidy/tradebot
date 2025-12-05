import { Pool } from 'pg';

export interface ClientBotEventInput {
  clientBotId: string;
  clientId: string;
  eventType: string;
  message?: string;
  metadata?: Record<string, unknown> | null;
}

export class ClientBotEventsRepository {
  constructor(private readonly pool: Pool) {}

  async insert(input: ClientBotEventInput) {
    await this.pool.query(
      `INSERT INTO client_bot_events (client_bot_id, client_id, event_type, message, metadata)
       VALUES ($1,$2,$3,$4,$5)`,
      [input.clientBotId, input.clientId, input.eventType, input.message ?? null, input.metadata ?? null]
    );
  }

  async listByBot(botId: string, limit = 50) {
    const res = await this.pool.query(
      `SELECT id, client_bot_id, client_id, event_type, message, metadata, created_at
       FROM client_bot_events
       WHERE client_bot_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [botId, limit]
    );
    return res.rows;
  }
}
