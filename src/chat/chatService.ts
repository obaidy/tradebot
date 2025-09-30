import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { ChatRepo, ConversationRecord, MessageRecord } from './chatRepo';
import { logger } from '../utils/logger';

export interface CreateConversationParams {
  clientId: string;
  orgId?: string | null;
  subject?: string | null;
  retentionDays?: number;
  metadata?: Record<string, unknown>;
}

export interface SendMessageParams {
  conversationId: string;
  senderType: 'client' | 'agent' | 'bot' | 'system';
  senderId?: string | null;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface ChatEvent {
  type: 'message' | 'status' | 'assignment' | 'system';
  payload: any;
}

type Listener = (event: ChatEvent) => void;

export class ChatService {
  private repo: ChatRepo;
  private listeners: Map<string, Set<Listener>> = new Map();

  constructor(private pool: Pool) {
    this.repo = new ChatRepo(pool);
  }

  async ensureConversation(params: CreateConversationParams): Promise<ConversationRecord> {
    const existing = await this.repo.findActiveConversationForClient(params.clientId);
    if (existing) return existing;

    const now = new Date();
    const retentionExpiresAt = params.retentionDays
      ? new Date(now.getTime() + params.retentionDays * 24 * 60 * 60 * 1000)
      : null;

    const conversation = await this.repo.createConversation({
      id: randomUUID(),
      clientId: params.clientId,
      orgId: params.orgId ?? null,
      subject: params.subject ?? null,
      retentionExpiresAt,
      metadata: params.metadata ?? null,
    });

    await this.repo.addParticipant({
      conversationId: conversation.id,
      participantId: params.clientId,
      participantType: 'client',
      role: 'owner',
    });
    return conversation;
  }

  async sendMessage(params: SendMessageParams): Promise<MessageRecord> {
    const message = await this.repo.insertMessage({
      id: randomUUID(),
      conversationId: params.conversationId,
      senderType: params.senderType,
      senderId: params.senderId ?? null,
      body: params.body,
      metadata: params.metadata ?? null,
      sentiment: await this.analyzeSentiment(params.body),
      translation: null,
    });
    await this.repo.updateConversationTimestamps(params.conversationId, message.created_at);
    this.emit(params.conversationId, {
      type: 'message',
      payload: message,
    });
    if (params.senderType === 'client') {
      this.notifySlack(`New client message in conversation ${params.conversationId}: ${params.body}`);
    }
    return message;
  }

  async updateStatus(conversationId: string, status: string, metadata?: Record<string, unknown>) {
    const updated = await this.repo.updateConversationStatus(conversationId, status, metadata);
    if (updated) {
      this.emit(conversationId, { type: 'status', payload: updated });
    }
    return updated;
  }

  async assignAgent(conversationId: string, agentId: string) {
    await this.repo.addParticipant({
      conversationId,
      participantId: agentId,
      participantType: 'agent',
      role: 'assignee',
    });
    this.emit(conversationId, { type: 'assignment', payload: { agentId } });
  }

  async listConversations(filter: Parameters<ChatRepo['listConversations']>[0]) {
    return this.repo.listConversations(filter);
  }

  async getConversation(conversationId: string) {
    return this.repo.getConversationById(conversationId);
  }

  async getMessages(conversationId: string, opts?: { after?: Date; limit?: number }) {
    return this.repo.getMessages(conversationId, opts);
  }

  async listParticipants(conversationId: string) {
    return this.repo.listParticipants(conversationId);
  }

  on(conversationId: string, listener: Listener) {
    if (!this.listeners.has(conversationId)) {
      this.listeners.set(conversationId, new Set());
    }
    this.listeners.get(conversationId)!.add(listener);
  }

  off(conversationId: string, listener: Listener) {
    const set = this.listeners.get(conversationId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(conversationId);
    }
  }

  private emit(conversationId: string, event: ChatEvent) {
    const set = this.listeners.get(conversationId);
    if (!set) return;
    set.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        logger.warn('chat_listener_error', {
          conversationId,
          error: err instanceof Error ? err.message : err,
        });
      }
    });
  }

  private async analyzeSentiment(body: string): Promise<Record<string, unknown> | null> {
    if (!body.trim()) return null;
    // Placeholder: mark strong negative keywords
    const lowered = body.toLowerCase();
    if (/(angry|frustrated|terrible|awful|cancel)/.test(lowered)) {
      return { label: 'negative', confidence: 0.6 };
    }
    if (/(love|great|awesome|thanks|thank you)/.test(lowered)) {
      return { label: 'positive', confidence: 0.6 };
    }
    return { label: 'neutral', confidence: 0.4 };
  }

  private notifySlack(message: string) {
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (!webhook) {
      logger.info('chat_slack_stub', { message });
      return;
    }
    const runtimeFetch = (globalThis as any).fetch as typeof fetch | undefined;
    if (!runtimeFetch) {
      logger.warn('chat_slack_missing_fetch');
      return;
    }
    runtimeFetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    }).catch((err) => {
      logger.warn('chat_slack_error', { error: err instanceof Error ? err.message : err });
    });
  }
}

const serviceByPool = new WeakMap<Pool, ChatService>();

export function getChatService(pool: Pool) {
  if (!serviceByPool.has(pool)) {
    serviceByPool.set(pool, new ChatService(pool));
  }
  return serviceByPool.get(pool)!;
}
