import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type Sender = 'bot' | 'user';

type ChatMessage = {
  id: string;
  sender: Sender;
  text: string;
};

type QuickReply = {
  label: string;
  text: string;
};

const BOT_RESPONSES: Array<{ pattern: RegExp; reply: string }> = [
  {
    pattern: /(price|plan|billing|subscription)/i,
    reply: 'Pricing lives under Billing → Plans. Need a custom quote? I can loop in the ops pod at operations@octobot.ai.',
  },
  {
    pattern: /(onboard|setup|getting started|start)/i,
    reply: 'Kick off onboarding from the Dashboard → Overview card. I also dropped our quick start checklist in Docs → Onboarding.',
  },
  {
    pattern: /(live|promotion|deploy|go live)/i,
    reply: 'Live promotion unlocks once walk-forward and paper gates pass. I can page a human if you need an override—just say "handoff".',
  },
  {
    pattern: /(support|help|human|handoff)/i,
    reply: 'A human operator is one tentacle away. Email operations@octobot.ai or drop your request here and I will escalate.',
  },
  {
    pattern: /(api|docs|documentation)/i,
    reply: 'API docs live under Docs → API Reference. The Admin API is authenticated with the bearer token in your workspace settings.',
  },
];

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

function createBotReply(userText: string): string {
  const match = BOT_RESPONSES.find(({ pattern }) => pattern.test(userText));
  if (match) return match.reply;
  return "I'm listening! I can share docs, surface telemetry, or loop in a human at operations@octobot.ai.";
}

export function OctopusChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'intro',
      sender: 'bot',
      text: 'Hey, I’m Octavia 🐙. Need help with OctoBot? Ask me anything or tap a quick reply below.',
    },
  ]);
  const [input, setInput] = useState('');
  const [pendingReply, setPendingReply] = useState(false);
  const pendingTimeout = useRef<NodeJS.Timeout | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    return undefined;
  }, [isOpen, messages.length]);

  useEffect(() => {
    return () => {
      if (pendingTimeout.current) {
        clearTimeout(pendingTimeout.current);
      }
    };
  }, []);

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  const pushMessage = (sender: Sender, text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sender,
        text,
      },
    ]);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    const text = input.trim();
    pushMessage('user', text);
    setInput('');
    scheduleBotReply(text);
  };

  const scheduleBotReply = (userText: string) => {
    if (pendingTimeout.current) {
      clearTimeout(pendingTimeout.current);
    }
    setPendingReply(true);
    pendingTimeout.current = setTimeout(() => {
      pushMessage('bot', createBotReply(userText));
      setPendingReply(false);
      pendingTimeout.current = null;
    }, 600 + Math.random() * 400);
  };

  const handleQuickReply = (reply: QuickReply) => {
    setIsOpen(true);
    pushMessage('user', reply.text);
    scheduleBotReply(reply.text);
  };

  const hasHumanEscalation = useMemo(
    () => messages.some((m) => /(ops|human|support|handoff)/i.test(m.text) && m.sender === 'user'),
    [messages]
  );

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

          <div className="octobot-chat__messages" aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`octobot-chat__bubble octobot-chat__bubble--${message.sender}`}
              >
                {message.text}
              </div>
            ))}
            {pendingReply ? (
              <div className="octobot-chat__bubble octobot-chat__bubble--bot octobot-chat__bubble--typing">
                <span />
                <span />
                <span />
              </div>
            ) : null}
            <div ref={chatEndRef} />
          </div>

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

          <form className="octobot-chat__composer" onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              placeholder="Ask me anything…"
              onChange={(event) => setInput(event.target.value)}
              aria-label="Message Octavia"
            />
            <button type="submit" disabled={!input.trim()}>
              Send
            </button>
          </form>

          <footer className="octobot-chat__footer">
            {hasHumanEscalation ? (
              <span>
                A human operator will follow up shortly. You can also email <a href="mailto:operations@octobot.ai">operations@octobot.ai</a>.
              </span>
            ) : (
              <span>
                Need a human? Type <span className="octobot-chat__inline-code">handoff</span> or email
                {' '}
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
