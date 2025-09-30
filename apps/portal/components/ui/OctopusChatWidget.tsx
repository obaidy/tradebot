import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type SenderType = 'client' | 'agent' | 'bot' | 'system';

type ChatMessage = {
  id: string;
  senderType: SenderType;
  senderId?: string | null;
  body: string;
  createdAt: string;
};

type ConversationSummary = {
  id: string;
  status: string;
  lastMessageAt: string;
  createdAt: string;
};

type QuickReply = {
  label: string;
  text: string;
};

const QUICK_REPLIES: QuickReply[] = [
  {
    label: 'Getting started',
    text: 'Hi Octavia, can you remind me how to start onboarding a new client?',
  },
  {
    label: 'Billing question',
    text: 'What happens when a trial expires and how do I update payment info?',
  },
  {
    label: 'Talk to ops',
    text: 'Please connect me with the operations team for a live deployment check.',
  },
];

const HISTORY_LIMIT = 5;

export function OctopusChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const eventsRef = useRef<EventSource | null>(null);

  useEffect(() => {
    bootstrap();
    return () => {
      eventsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    if (eventsRef.current) {
      eventsRef.current.close();
    }
    const source = new EventSource(`/api/chat/conversations/${conversationId}/events`);
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === 'message') {
          const message = data.payload;
          appendMessage({
            id: message.id,
            senderType: message.sender_type ?? message.senderType ?? 'bot',
            senderId: message.sender_id ?? null,
            body: message.body,
            createdAt: message.created_at,
          });
        } else if (data?.type === 'status') {
          setHistory((prev) =>
            prev.map((item) =>
              item.id === conversationId
                ? { ...item, status: data.payload.status, lastMessageAt: data.payload.last_message_at }
                : item
            )
          );
        }
      } catch (err) {
        console.error('[octobot-chat] failed to parse event', err);
      }
    };
    source.onerror = () => {
      source.close();
      eventsRef.current = null;
    };
    eventsRef.current = source;
    return () => {
      source.close();
    };
  }, [conversationId]);

  useEffect(() => {
    if (!isOpen) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [isOpen, messages.length]);

  const appendMessage = (message: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((existing) => existing.id === message.id)) {
        return prev;
      }
      return [...prev, message];
    });
  };

  const bootstrap = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/chat/conversations', { method: 'POST' });
      if (response.status === 401) {
        setRequiresAuth(true);
        setMessages([]);
        setHistory([]);
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to initialize chat');
      }
      const data = await response.json();
      const conv = data.conversation;
      setConversationId(conv.id);
      setMessages(
        (data.messages ?? []).map((msg: any) => ({
          id: msg.id,
          senderType: msg.sender_type ?? 'bot',
          senderId: msg.sender_id ?? null,
          body: msg.body,
          createdAt: msg.created_at,
        }))
      );
      await loadHistory();
    } catch (err) {
      console.error('[octobot-chat] bootstrap failed', err);
      setError('Unable to load support chat. Please refresh later.');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/chat/conversations?limit=5');
      if (!res.ok) return;
      const data = await res.json();
      const conversations = (data.conversations ?? []) as any[];
      setHistory(
        conversations.slice(0, HISTORY_LIMIT).map((item) => ({
          id: item.id,
          status: item.status,
          lastMessageAt: item.last_message_at,
          createdAt: item.created_at,
        }))
      );
    } catch (err) {
      console.error('[octobot-chat] history load failed', err);
    }
  };

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
    if (!isOpen) {
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 150);
    }
  };

  const sendChatMessage = async (text: string) => {
    if (requiresAuth || !text.trim() || !conversationId) return;
    const trimmed = text.trim();
    const optimisticId = `temp-${Date.now()}`;
    appendMessage({
      id: optimisticId,
      senderType: 'client',
      senderId: 'me',
      body: trimmed,
      createdAt: new Date().toISOString(),
    });
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) {
        throw new Error('send_failed');
      }
      await loadHistory();
    } catch (err) {
      console.error('[octobot-chat] send failed', err);
      setError('Message failed to send. Retrying shortly.');
      setTimeout(() => {
        setError(null);
      }, 4000);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    const text = input;
    setInput('');
    await sendChatMessage(text);
  };

  const handleQuickReply = async (reply: QuickReply) => {
    if (requiresAuth) return;
    setIsOpen(true);
    await sendChatMessage(reply.text);
  };

  const hasHumanEscalation = useMemo(
    () => messages.some((m) => m.senderType === 'agent'),
    [messages]
  );

  const historyList = history.filter((conv) => conv.id !== conversationId);

  return (
    <div className={`octobot-chat ${isOpen ? 'octobot-chat--open' : ''}`}>
      {isOpen ? (
        <div className="octobot-chat__panel" role="dialog" aria-label="OctoBot support chat">
          <header className="octobot-chat__header">
            <div className="octobot-chat__heading">
              <OctopusGlyph />
              <div>
                <p className="octobot-chat__title">Chat with Octavia</p>
                <p className="octobot-chat__subtitle">OctoBot support pod</p>
              </div>
            </div>
            <button
              type="button"
              className="octobot-chat__close"
              onClick={handleToggle}
              aria-label="Close support chat"
            >
              ×
            </button>
          </header>

          {requiresAuth ? null : historyList.length ? (
            <section className="octobot-chat__history">
              <p className="octobot-chat__history-title">Recent conversations</p>
              <div className="octobot-chat__history-items">
                {historyList.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="octobot-chat__history-pill"
                    onClick={async () => {
                      const res = await fetch(`/api/chat/conversations/${item.id}`);
                      if (!res.ok) return;
                      const data = await res.json();
                      setConversationId(data.conversation.id);
                      setMessages(
                        (data.messages ?? []).map((msg: any) => ({
                          id: msg.id,
                          senderType: msg.sender_type ?? 'bot',
                          senderId: msg.sender_id ?? null,
                          body: msg.body,
                          createdAt: msg.created_at,
                        }))
                      );
                    }}
                  >
                    <span>{formatStatus(item.status)}</span>
                    <span>{formatTime(item.lastMessageAt)}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="octobot-chat__messages" aria-live="polite">
            {loading && !requiresAuth ? (
              <div className="octobot-chat__bubble octobot-chat__bubble--bot">Booting up the reef…</div>
            ) : null}
            {requiresAuth ? (
              <div className="octobot-chat__bubble octobot-chat__bubble--bot">
                <p style={{ margin: 0 }}>Sign in to OctoBot Portal to start a conversation.</p>
                <Link href="/app" legacyBehavior>
                  <a className="octobot-chat__auth-link">Go to sign in</a>
                </Link>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`octobot-chat__bubble octobot-chat__bubble--${bubbleClass(message.senderType)}`}
                  >
                    {message.body}
                    <span className="octobot-chat__timestamp">{formatTime(message.createdAt)}</span>
                  </div>
                ))}
              </>
            )}
            <div ref={chatEndRef} />
          </div>

          {requiresAuth ? null : (
            <div className="octobot-chat__quick-replies">
              {QUICK_REPLIES.map((reply) => (
                <button
                  key={reply.label}
                  type="button"
                  className="octobot-chat__chip"
                  onClick={() => handleQuickReply(reply)}
                >
                  {reply.label}
                </button>
              ))}
            </div>
          )}

          <form className="octobot-chat__composer" onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              placeholder={requiresAuth ? 'Sign in to chat with Octavia' : 'Ask me anything…'}
              onChange={(event) => setInput(event.target.value)}
              aria-label="Message Octavia"
              disabled={loading || !conversationId || requiresAuth}
            />
            <button type="submit" disabled={!input.trim() || !conversationId || requiresAuth}>
              Send
            </button>
          </form>

          <footer className="octobot-chat__footer">
            {error ? (
              <span className="octobot-chat__error">{error}</span>
            ) : requiresAuth ? (
              <span>
                Sign in to your OctoBot account to open a support conversation.
              </span>
            ) : hasHumanEscalation ? (
              <span>
                An operator has joined this chat. We’ll follow up in Slack if you step away.
              </span>
            ) : (
              <span>
                Need a human? Type <span className="octobot-chat__inline-code">handoff</span> or email{' '}
                <a href="mailto:operations@octobot.ai">operations@octobot.ai</a>.
              </span>
            )}
          </footer>
        </div>
      ) : null}

      <button
        type="button"
        className="octobot-chat__launcher"
        aria-label={isOpen ? 'Hide support chat' : 'Open support chat'}
        onClick={handleToggle}
      >
        <OctopusGlyph animate={!isOpen} />
      </button>
    </div>
  );
}

function bubbleClass(senderType: SenderType): 'bot' | 'user' {
  if (senderType === 'client') return 'user';
  if (senderType === 'agent') return 'bot';
  if (senderType === 'system') return 'bot';
  return 'bot';
}

function formatTime(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatStatus(status: string) {
  switch (status) {
    case 'open':
      return 'Open';
    case 'waiting_client':
      return 'Waiting on you';
    case 'pending':
      return 'Pending';
    case 'closed':
      return 'Closed';
    default:
      return status;
  }
}

function OctopusGlyph({ animate = true }: { animate?: boolean }) {
  return (
    <svg
      className={animate ? 'octobot-glyph octobot-glyph--animate' : 'octobot-glyph'}
      viewBox="0 0 96 96"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="octobot-glyph-core" cx="50%" cy="36%" r="62%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="60%" stopColor="#0EA5E9" />
          <stop offset="100%" stopColor="#1E1B4B" />
        </radialGradient>
        <linearGradient id="octobot-glyph-tentacle" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
      </defs>
      <g
        className="octobot-glyph__glow"
        fill="none"
        stroke="url(#octobot-glyph-tentacle)"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path strokeWidth="5" d="M14 56c6 9 16 15 26 17" />
        <path strokeWidth="4" opacity="0.7" d="M8 49c8 12 24 21 36 23" />
        <path strokeWidth="5" d="M82 56c-6 9-16 15-26 17" />
        <path strokeWidth="4" opacity="0.7" d="M88 49c-8 12-24 21-36 23" />
      </g>
      <path
        className="octobot-glyph__body"
        d="M48 18c-14 0-26 10-26 24 0 15 12 30 26 30s26-15 26-30c0-14-12-24-26-24z"
        fill="url(#octobot-glyph-core)"
      />
      <ellipse className="octobot-glyph__eye" cx="36" cy="38" rx="6" ry="7" fill="#F8FAFC" />
      <ellipse className="octobot-glyph__eye" cx="60" cy="38" rx="6" ry="7" fill="#F8FAFC" />
      <circle cx="36" cy="39" r="3" fill="#0F172A" />
      <circle cx="60" cy="39" r="3" fill="#0F172A" />
      <path d="M38 48c3 2 7 3 10 3s7-1 10-3" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
