import { Pool, QueryResult } from 'pg';

export interface ConversationRecord {
  id: string;
  client_id: string;
  org_id: string | null;
  status: string;
  subject: string | null;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date;
  retention_expires_at: Date | null;
  metadata: Record<string, unknown> | null;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  body: string;
  metadata: Record<string, unknown> | null;
  sentiment: Record<string, unknown> | null;
  translation: Record<string, unknown> | null;
  created_at: Date;
}

export interface ParticipantRecord {
  conversation_id: string;
  participant_id: string;
  participant_type: string;
  role: string | null;
  joined_at: Date;
  left_at: Date | null;
}

export class ChatRepo {
  constructor(private pool: Pool) {}

  async createConversation(record: {
    id: string;
    clientId: string;
    orgId?: string | null;
    status?: string;
    subject?: string | null;
    retentionExpiresAt?: Date | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<ConversationRecord> {
    const result = await this.pool.query<ConversationRecord>(
      `INSERT INTO chat_conversations (id, client_id, org_id, status, subject, retention_expires_at, metadata)
       VALUES ($1, $2, $3, COALESCE($4, 'open'), $5, $6, $7)
       RETURNING *`,
      [
        record.id,
        record.clientId,
        record.orgId ?? null,
        record.status ?? 'open',
        record.subject ?? null,
        record.retentionExpiresAt ?? null,
        record.metadata ?? null,
      ]
    );
    return result.rows[0];
  }

  async updateConversationTimestamps(id: string, lastMessageAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE id = $1`,
      [id, lastMessageAt]
    );
  }

  async updateConversationStatus(id: string, status: string, metadata?: Record<string, unknown>): Promise<ConversationRecord | null> {
    const result = await this.pool.query<ConversationRecord>(
      `UPDATE chat_conversations
         SET status = $2,
             updated_at = NOW(),
             metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($3::jsonb, '{}'::jsonb)
       WHERE id = $1
       RETURNING *`,
      [id, status, metadata ?? null]
    );
    return result.rows[0] ?? null;
  }

  async getConversationById(id: string): Promise<ConversationRecord | null> {
    const result = await this.pool.query<ConversationRecord>(
      `SELECT * FROM chat_conversations WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async findActiveConversationForClient(clientId: string): Promise<ConversationRecord | null> {
    const result = await this.pool.query<ConversationRecord>(
      `SELECT * FROM chat_conversations
         WHERE client_id = $1 AND status IN ('open', 'pending', 'waiting_client')
         ORDER BY last_message_at DESC
         LIMIT 1`,
      [clientId]
    );
    return result.rows[0] ?? null;
  }

  async listConversations(filter: {
    status?: string;
    clientId?: string;
    orgId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ConversationRecord[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (filter.status) {
      values.push(filter.status);
      clauses.push(`status = $${values.length}`);
    }
    if (filter.clientId) {
      values.push(filter.clientId);
      clauses.push(`client_id = $${values.length}`);
    }
    if (filter.orgId) {
      values.push(filter.orgId);
      clauses.push(`org_id = $${values.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push(filter.limit ?? 50);
    const limitIndex = values.length;
    values.push(filter.offset ?? 0);
    const offsetIndex = values.length;

    const query = `SELECT * FROM chat_conversations ${where}
                     ORDER BY last_message_at DESC
                     LIMIT $${limitIndex} OFFSET $${offsetIndex}`;
    const result = await this.pool.query<ConversationRecord>(query, values);
    return result.rows;
  }

  async insertMessage(record: {
    id: string;
    conversationId: string;
    senderType: string;
    senderId?: string | null;
    body: string;
    metadata?: Record<string, unknown> | null;
    sentiment?: Record<string, unknown> | null;
    translation?: Record<string, unknown> | null;
  }): Promise<MessageRecord> {
    const result = await this.pool.query<MessageRecord>(
      `INSERT INTO chat_messages (id, conversation_id, sender_type, sender_id, body, metadata, sentiment, translation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        record.id,
        record.conversationId,
        record.senderType,
        record.senderId ?? null,
        record.body,
        record.metadata ?? null,
        record.sentiment ?? null,
        record.translation ?? null,
      ]
    );
    return result.rows[0];
  }

  async getMessages(conversationId: string, opts: { after?: Date; limit?: number } = {}): Promise<MessageRecord[]> {
    const values: unknown[] = [conversationId];
    const clauses = ['conversation_id = $1'];
    if (opts.after) {
      values.push(opts.after);
      clauses.push(`created_at > $${values.length}`);
    }
    values.push(opts.limit ?? 100);
    const query = `SELECT * FROM chat_messages
                     WHERE ${clauses.join(' AND ')}
                     ORDER BY created_at ASC
                     LIMIT $${values.length}`;
    const result = await this.pool.query<MessageRecord>(query, values);
    return result.rows;
  }

  async addParticipant(record: {
    conversationId: string;
    participantId: string;
    participantType: string;
    role?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO chat_participants (conversation_id, participant_id, participant_type, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversation_id, participant_id, participant_type)
       DO UPDATE SET role = EXCLUDED.role, left_at = NULL`,
      [record.conversationId, record.participantId, record.participantType, record.role ?? null]
    );
  }

  async markParticipantLeft(conversationId: string, participantId: string, participantType: string): Promise<void> {
    await this.pool.query(
      `UPDATE chat_participants
         SET left_at = NOW()
       WHERE conversation_id = $1 AND participant_id = $2 AND participant_type = $3`,
      [conversationId, participantId, participantType]
    );
  }

  async listParticipants(conversationId: string): Promise<ParticipantRecord[]> {
    const result = await this.pool.query<ParticipantRecord>(
      `SELECT * FROM chat_participants WHERE conversation_id = $1`,
      [conversationId]
    );
    return result.rows;
  }
}
