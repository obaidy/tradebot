import Head from 'next/head';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

interface ConversationSummary {
  id: string;
  status: string;
  client_id: string;
  client_name?: string | null;
  last_message_at: string;
  created_at: string;
}

interface ChatMessage {
  id: string;
  sender_type: 'client' | 'agent' | 'bot' | 'system';
  sender_id: string | null;
  body: string;
  created_at: string;
}

export default function SupportInbox() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<'open' | 'pending' | 'waiting_client' | 'closed'>('open');
  const [error, setError] = useState<string | null>(null);
  const eventsRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/chat/conversations?status=${statusFilter}`);
      if (!res.ok) throw new Error('load_failed');
      const data = await res.json();
      const list = (data.conversations ?? []).map((item: any) => ({
        id: item.id,
        status: item.status,
        client_id: item.client_id,
        client_name: item.client_name,
        last_message_at: item.last_message_at,
        created_at: item.created_at,
      }));
      setConversations(list);
      if (!selectedId && list.length) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      console.error('[support] load conversations failed', err);
    }
  }, [selectedId, statusFilter]);

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 15000);
    return () => clearInterval(interval);
  }, [loadConversations]);

  const fetchConversation = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/admin/chat/conversations/${conversationId}`);
      if (!res.ok) throw new Error('detail_load_failed');
      const data = await res.json();
      setMessages(
        (data.messages ?? []).map((msg: any) => ({
          id: msg.id,
          sender_type: msg.sender_type,
          sender_id: msg.sender_id,
          body: msg.body,
          created_at: msg.created_at,
        }))
      );
    } catch (err) {
      console.error('[support] fetch conversation failed', err);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    fetchConversation(selectedId);
    if (eventsRef.current) eventsRef.current.close();
    const source = new EventSource(`/api/admin/chat/conversations/${selectedId}/events`);
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === 'message') {
          setMessages((prev) => {
            const exists = prev.some((msg) => msg.id === data.payload.id);
            if (exists) return prev;
            return [...prev, data.payload];
          });
          fetchConversation(selectedId);
          loadConversations();
        }
        if (data?.type === 'status') {
          loadConversations();
        }
      } catch (err) {
        console.error('[support] event parse failed', err);
      }
    };
    source.onerror = () => {
      source.close();
      eventsRef.current = null;
    };
    eventsRef.current = source;
    const poll = setInterval(() => {
      fetchConversation(selectedId);
    }, 8000);
    return () => {
      source.close();
      clearInterval(poll);
    };
  }, [fetchConversation, loadConversations, selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);


  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!input.trim() || !selectedId) return;
    const text = input.trim();
    setInput('');
    try {
      const res = await fetch(`/api/admin/chat/conversations/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) throw new Error('send_failed');
    } catch (err) {
      console.error('[support] send failed', err);
      setError('Failed to send reply');
      setTimeout(() => setError(null), 4000);
    }
  };

  return (
    <DashboardLayout>
      <Head>
        <title>OctoBot · Support Inbox</title>
      </Head>
      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <h1 style={{ margin: 0 }}>Support Inbox</h1>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {(['open', 'pending', 'waiting_client', 'closed'] as const).map((status) => (
              <Button
                key={status}
                variant={statusFilter === status ? 'primary' : 'secondary'}
                onClick={() => setStatusFilter(status)}
              >
                {status.replace('_', ' ')}
              </Button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '1.5rem',
            gridTemplateColumns: 'minmax(280px, 320px) 1fr',
            alignItems: 'start',
          }}
        >
          <Card style={{ display: 'grid', gap: '0.85rem', padding: '1.25rem' }}>
            <h2 style={{ margin: 0, fontSize: '1rem' }}>Conversations</h2>
            <div style={{ display: 'grid', gap: '0.65rem', maxHeight: 460, overflowY: 'auto' }}>
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  style={{
                    border: '1px solid rgba(56,189,248,0.28)',
                    borderRadius: '14px',
                    padding: '0.75rem',
                    background:
                      selectedId === conversation.id ? 'rgba(15, 23, 42, 0.8)' : 'rgba(15, 23, 42, 0.55)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'grid',
                    gap: '0.35rem',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    {conversation.client_name ?? conversation.client_id}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}>
                    Updated {new Date(conversation.last_message_at).toLocaleString()}
                  </span>
                  <Badge tone={conversation.status === 'open' ? 'primary' : conversation.status === 'waiting_client' ? 'warning' : 'neutral'}>
                    {conversation.status.replace('_', ' ')}
                  </Badge>
                </button>
              ))}
              {conversations.length === 0 ? <span style={{ color: '#94A3B8' }}>No conversations yet.</span> : null}
            </div>
          </Card>

          <Card style={{ display: 'grid', gap: '1rem', minHeight: 480, maxHeight: 640 }}>
            {selectedId ? (
              <>
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'grid', gap: '0.25rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1rem' }}>Conversation</h2>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#94A3B8' }}>#{selectedId.slice(0, 8)}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        await fetch(`/api/admin/chat/conversations/${selectedId}/claim`, { method: 'POST' });
                        await loadConversations();
                      }}
                    >
                      Claim
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        await fetch(`/api/admin/chat/conversations/${selectedId}/status`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: 'closed' }),
                        });
                        await loadConversations();
                      }}
                    >
                      Close
                    </Button>
                  </div>
                </header>

                <div
                  style={{
                    display: 'grid',
                    gap: '0.75rem',
                    alignContent: 'start',
                    maxHeight: 380,
                    overflowY: 'auto',
                    paddingRight: '0.5rem',
                  }}
                >
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      style={{
                        background:
                          message.sender_type === 'client'
                            ? 'rgba(56,189,248,0.18)'
                            : message.sender_type === 'agent'
                            ? 'rgba(15, 23, 42, 0.85)'
                            : 'rgba(15,23,42,0.6)',
                        border: '1px solid rgba(56,189,248,0.25)',
                        borderRadius: 14,
                        padding: '0.75rem',
                        display: 'grid',
                        gap: '0.35rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94A3B8' }}>
                        <span>{labelForSender(message)}</span>
                        <span>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p style={{ margin: 0 }}>{message.body}</p>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>

                <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Type a reply…"
                    style={{
                      flex: 1,
                      borderRadius: 12,
                      border: '1px solid rgba(148,163,184,0.25)',
                      background: 'rgba(8,13,25,0.85)',
                      color: '#E2E8F0',
                      padding: '0.65rem 0.85rem',
                    }}
                  />
                  <Button type="submit" disabled={!input.trim()}>
                    Reply
                  </Button>
                </form>
                {error ? <p style={{ color: '#F87171', margin: 0 }}>{error}</p> : null}
              </>
            ) : (
              <div style={{ textAlign: 'center', color: '#94A3B8' }}>Select a conversation to begin.</div>
            )}
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function labelForSender(message: ChatMessage) {
  if (message.sender_type === 'client') return 'Client';
  if (message.sender_type === 'agent') return 'You';
  if (message.sender_type === 'bot') return 'Octavia';
  return 'System';
}
