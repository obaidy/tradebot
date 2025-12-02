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
    headline: 'Connect your exchange. Pick a bot. Let it trade for you 24/7.',
    subheadline:
      'Bring your own Binance API keys, choose a grid or DCA template, and monitor every fill from the same place. You stay in control of deposits and withdrawals.',
    primaryCta: 'Open the portal',
    secondaryCta: 'Browse bots',
    trustBadges: ['Self-custody keys', 'Paper + live modes', 'Transparent trade log'],
  },
  featureSections: [
    {
      title: 'Adaptive Tentacles',
      description:
        'Each limb tunes risk in real time with regime analysis, volatility guards, and intelligent kill switches that surface before drift hits PnL.',
    },
    {
      title: 'Paper-to-Live Tide',
      description:
        'Walk-forward regressions, automated paper canaries, and human promotion gates keep every promotion traceable from first splash to live waters.',
    },
    {
      title: 'Ops Reef',
      description:
        'Unified telemetry dashboards, client workflows, billing automation, and on-call tooling that keep operators in control of every tentacle.',
    },
  ],
};

export const pricingPlans = [
  {
    name: 'Paper',
    price: '$0',
    cadence: 'per month',
    highlight: 'Perfect for exploratory deep dives',
    features: ['Unlimited paper pods', 'Walk-forward tide reports', 'Alert integrations', 'Release artefact archive'],
    cta: 'Swim in Paper',
    popular: false,
  },
  {
    name: 'Pro',
    price: '$149',
    cadence: 'per month',
    highlight: 'All eight arms unlocked for live execution',
    features: [
      'Live promotion gates',
      'Multi-exchange credentials',
      'Ops reef command center',
      'Priority pod support',
    ],
    cta: 'Upgrade to Pro',
    popular: true,
  },
  {
    name: 'Institutional',
    price: 'Let’s talk',
    cadence: 'custom retainers',
    highlight: 'Tailored deployments & white-glove coverage',
    features: ['Dedicated reef cluster', '24/7 incident hotline', 'Custom guard policies', 'Private signal integrations'],
    cta: 'Book a Strategy Call',
    popular: false,
  },
];

export const testimonials = [
  {
    quote:
      'Paper-to-live is finally one workflow. We ship grid updates twice a week and the guard rails catch issues before our capital ever feels them.',
    name: 'Lina Park',
    role: 'Head of Digital Assets, Northwind Capital',
  },
  {
    quote:
      'The telemetry cockpit and release artefacts make investor reporting a non-event. We have audit logs for every switch flip.',
    name: 'Matteo Ricci',
    role: 'COO, Meridian Alpha',
  },
  {
    quote:
      'We onboarded 40+ traders without engineering churn. Stripe billing, KYC hooks, and multi-venue grids just work.',
    name: 'Priya Desai',
    role: 'Founder, Horizon Quant Club',
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
  testimonials,
  faqItems,
};

export type Theme = typeof theme;
