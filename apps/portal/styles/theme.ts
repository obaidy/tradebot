export const palette = {
  background: '#020617',
  backgroundAlt: '#071426',
  surface: '#0B1F33',
  surfaceAlt: '#15314D',
  border: 'rgba(34, 211, 238, 0.18)',
  primary: '#22D3EE',
  primaryStrong: '#0EA5E9',
  secondary: '#8B5CF6',
  accent: '#F472B6',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#F87171',
  textPrimary: '#E2E8F0',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  gradientHero:
    'linear-gradient(135deg, rgba(34,211,238,0.25) 0%, rgba(139,92,246,0.18) 50%, rgba(244,114,182,0.18) 100%)',
  glass: 'rgba(9, 20, 38, 0.68)'
};

export const typography = {
  fontFamily: `'Inter', 'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
  heading: {
    weight: 700,
    letterSpacing: '-0.02em',
  },
  label: {
    weight: 600,
    letterSpacing: '0.08em',
    transform: 'uppercase',
  },
  body: {
    weight: 400,
    lineHeight: 1.6,
  },
};

export const layout = {
  maxWidth: '1200px',
  sectionSpacing: 'min(8vw, 6rem)',
  cardPadding: '1.75rem',
  borderRadius: '20px',
  shadow: '0 25px 60px rgba(15, 23, 42, 0.45)',
  glassBorder: '1px solid rgba(148, 163, 184, 0.15)',
};

export const callouts = {
  hero: {
    headline: 'Automated crypto bots that trade for you 24/7.',
    subheadline: 'Works with Binance. Start in paper mode, go live when you are ready.',
    primaryCta: 'Open the portal',
    secondaryCta: 'Browse bots',
    trustBadges: ['Self-custody keys', 'Paper + live modes', 'Transparent trade log'],
  },
  featureSections: [
    {
      title: 'Self custody',
      description: 'API keys stay on your exchange account. Withdrawals remain disabled and you can revoke access any time.',
    },
    {
      title: 'Paper-first launch',
      description: 'Every bot starts in paper mode so you can watch behavior before putting real USDT behind it.',
    },
    {
      title: 'Simple telemetry',
      description: 'Track PnL, trades, and alerts from one dashboard instead of juggling spreadsheets and screenshots.',
    },
  ],
};

export const pricingPlans = [
  {
    name: 'Paper',
    price: '$0',
    cadence: 'per month',
    highlight: 'Practice with simulated capital',
    features: ['Unlimited paper bots', '24/7 activity log', 'Email alerts when bots pause'],
    cta: 'Start in paper',
    popular: false,
  },
  {
    name: 'Starter',
    price: '$29',
    cadence: 'per month',
    highlight: 'First live bot + modest caps',
    features: ['1 live bot', 'Up to $1k allocation', 'Pause/Resume from dashboard', 'Support by email'],
    cta: 'Upgrade to Starter',
    popular: false,
  },
  {
    name: 'Pro',
    price: '$79',
    cadence: 'per month',
    highlight: 'Multiple bots, higher limits',
    features: ['Up to 5 live bots', 'Higher allocation caps', 'Priority pause alerts', 'Early access to new strategies'],
    cta: 'Upgrade to Pro',
    popular: true,
  },
];

export const faqItems = [
  {
    question: 'How do you keep live trading safe?',
    answer:
      'Every release runs through walk-forward regression, paper canary, and manual approval with guard metrics recorded. Live promotion is blocked until all gates pass.',
  },
  {
    question: 'Which exchanges are supported?',
    answer:
      'Binance, Binance US, Coinbase Advanced, Bybit, OKX, and any CCXT-compatible venue. We auto-tune per exchange limits and order semantics.',
  },
  {
    question: 'Can we integrate our own risk checks?',
    answer:
      'Yes. Use the guard policy SDK or webhook hooks to inject custom checks, risk alerts, or shutoff signals before orders route out.',
  },
  {
    question: 'Do you help with compliance?',
    answer:
      'We provide tooling for KYC/AML hand-offs, audit-ready logs, release artefacts, and partner recommendations. Regulatory strategy remains your responsibility.',
  },
];

export const theme = {
  palette,
  typography,
  layout,
  callouts,
  pricingPlans,
  faqItems,
};

export type Theme = typeof theme;
