export const palette = {
  background: '#050816',
  backgroundAlt: '#0B1224',
  surface: '#111827',
  surfaceAlt: '#1F2937',
  border: 'rgba(148, 163, 184, 0.2)',
  primary: '#38BDF8',
  primaryStrong: '#0EA5E9',
  secondary: '#6366F1',
  accent: '#22D3EE',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#F87171',
  textPrimary: '#E2E8F0',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  gradientHero: 'linear-gradient(135deg, rgba(56,189,248,0.25) 0%, rgba(236,72,153,0.05) 50%, rgba(99,102,241,0.25) 100%)',
  glass: 'rgba(15, 23, 42, 0.6)'
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

export const metricsPlaceholders = {
  winRate: '82% paper win rate last 90 days',
  traders: '2,400+ traders automated',
  volume: '$185M lifetime volume managed',
  latency: 'Sub-200ms executive guard response',
};

export const callouts = {
  hero: {
    headline: 'Automated crypto execution built for pros',
    subheadline:
      'Deploy adaptive grid strategies, run paper canaries, and go live with full guard rails on a single control plane.',
    primaryCta: 'Launch Your First Grid',
    secondaryCta: 'View Live Telemetry',
    trustBadges: ['Binance', 'Bybit', 'Coinbase Advanced', 'Stripe Billing'],
  },
  featureSections: [
    {
      title: 'Adaptive Algorithms',
      description:
        'Multi-venue grid engine that tunes risk in real time using regime analysis, volatility guards, and kill switches.',
    },
    {
      title: 'Paper-to-Live Pipeline',
      description:
        'Walk-forward regressions, automated paper canaries, and manual promotion gates make every release auditable.',
    },
    {
      title: 'Operations Command Center',
      description:
        'Full telemetry dashboards, client workflows, billing automation, and on-call tooling to keep humans in control.',
    },
  ],
};

export const pricingPlans = [
  {
    name: 'Paper',
    price: '$0',
    cadence: 'per month',
    highlight: 'Perfect for exploratory testing',
    features: ['Unlimited paper grids', 'Walk-forward reports', 'Alert integrations', 'Release artifacts archive'],
    cta: 'Start in Paper',
    popular: false,
  },
  {
    name: 'Pro',
    price: '$149',
    cadence: 'per month',
    highlight: 'All you need to run live with confidence',
    features: [
      'Live promotion gates',
      'Multi-exchange credentials',
      'Ops command center',
      'Priority on-call support',
    ],
    cta: 'Upgrade to Pro',
    popular: true,
  },
  {
    name: 'Institutional',
    price: 'Let’s talk',
    cadence: 'custom retainers',
    highlight: 'Tailored deployments & white-glove coverage',
    features: ['Dedicated cluster', '24/7 incident hotline', 'Custom guard policies', 'Private signal integrations'],
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
  metricsPlaceholders,
  callouts,
  pricingPlans,
  testimonials,
  faqItems,
};

export type Theme = typeof theme;
