import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { HeroVisualization } from '../components/landing/HeroVisualization';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { callouts, faqItems, pricingPlans } from '../styles/theme';

const strategiesShowcase = [
  {
    id: 'grid',
    name: 'Grid Bot',
    headline: 'Buy low, sell high on repeat',
    description: 'Classic grid trading on BTC/USDT or ETH/USDT with guard rails and per-trade caps you control.',
    plans: 'Paper · Starter · Pro',
    highlights: ['Binance Spot', 'Paper + Live', 'Pause any time'],
  },
  {
    id: 'dca',
    name: 'DCA Bot',
    headline: 'Automated dollar-cost averaging',
    description: 'Pick a pair, choose your cadence, and let the bot accumulate while you monitor fills in the portal.',
    plans: 'Paper · Starter · Pro',
    highlights: ['Schedules or continuous', 'Paper-first', 'Ideal for treasury stacking'],
  },
  {
    id: 'momentum',
    name: 'Momentum Scout (beta)',
    headline: 'Ride breakouts with tight stops',
    description: 'A simple trend-following preset for users who want something spicier once they trust the grid/DCA flows.',
    plans: 'Pro',
    highlights: ['Beta access', 'Paper required', 'Opt-in risk'],
  },
];

const trustSignals = [
  {
    title: 'You keep custody',
    body: 'API keys stay in your exchange account. Withdrawals stay disabled and you can rotate or revoke keys any time.',
  },
  {
    title: 'Nothing to hide',
    body: 'Every trade, bot action, and API call is logged in the Activity tab so you always know what fired and when.',
  },
  {
    title: 'Built for Binance first',
    body: 'We support Binance Spot at launch so the UX, docs, and guardrails can stay painfully clear before adding more venues.',
  },
];

const onboardingSteps = [
  {
    title: '1. Connect Binance',
    body: 'Paste your API key and secret, keep withdrawals disabled, and run a quick connectivity check.',
  },
  {
    title: '2. Choose a bot',
    body: 'Start with Grid or DCA, pick a pair, set allocation, and decide between paper or live mode.',
  },
  {
    title: '3. Watch the activity feed',
    body: 'Trades, PnL, and alerts land in Activity so you know what the bot is doing before you add more capital.',
  },
];

export default function LandingPage() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const fakeSeries = Array.from({ length: 90 }, (_, i) => Math.sin(i / 6) * 12 + i * 0.4 + 60);
  return (
    <>
      <Head>
        <title>OctoBot · Automated Crypto Execution</title>
        <meta
          name="description"
          content="Deploy adaptive grid strategies, run paper canaries, and promote live with auditable guard rails."
        />
      </Head>
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            backdropFilter: 'blur(18px)',
            background: 'linear-gradient(90deg, rgba(5,8,22,0.85), rgba(5,8,22,0.6))',
            borderBottom: '1px solid rgba(148,163,184,0.12)',
          }}
        >
          <div className="container landing-nav">
            <Link href="/" legacyBehavior>
              <a className="landing-nav__brand">
                <Image src="/octobot-logo.svg" alt="OctoBot logo" width={38} height={38} />
                <span>OctoBot</span>
              </a>
            </Link>

            <nav className={`landing-nav__links ${mobileNavOpen ? 'landing-nav__links--open' : ''}`}>
              <Link href="/#why" legacyBehavior>
                <a onClick={() => setMobileNavOpen(false)}>Why OctoBot</a>
              </Link>
              <Link href="/#strategies" legacyBehavior>
                <a onClick={() => setMobileNavOpen(false)}>Strategies</a>
              </Link>
              <Link href="/#pricing" legacyBehavior>
                <a onClick={() => setMobileNavOpen(false)}>Pricing</a>
              </Link>
              <Link href="/#faq" legacyBehavior>
                <a onClick={() => setMobileNavOpen(false)}>FAQ</a>
              </Link>
              <Link href="/app" legacyBehavior>
                <a className="landing-nav__sign-in" onClick={() => setMobileNavOpen(false)}>
                  <Button variant="secondary">Sign in</Button>
                </a>
              </Link>
            </nav>

            <button
              type="button"
              className="landing-nav__toggle"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobileNavOpen}
            >
              <span />
              <span />
              <span />
            </button>
          </div>

          {mobileNavOpen ? <div className="landing-nav__overlay" onClick={() => setMobileNavOpen(false)} /> : null}
        </header>

        <main>
          <Section spacing="6rem 0" id="hero" containerClassName="landing-hero">
            <div className="landing-hero__content">
              <div className="landing-hero__headline">
                <Badge tone="primary">Binance bots · Self custody</Badge>
                <h1 className="section-heading gradient-text" style={{ margin: 0 }}>
                  {callouts.hero.headline}
                </h1>
                <p className="section-subheading" style={{ color: '#CBD5F5', margin: 0 }}>
                  {callouts.hero.subheadline}
                </p>
              </div>
              <div className="landing-hero__cta">
                <Link href="/app" legacyBehavior>
                  <a>
                    <Button>{callouts.hero.primaryCta}</Button>
                  </a>
                </Link>
                <Link href="/#strategies" legacyBehavior>
                  <a>
                    <Button variant="secondary">{callouts.hero.secondaryCta}</Button>
                  </a>
                </Link>
              </div>
              <div className="landing-hero__badges">
                {callouts.hero.trustBadges.map((badge) => (
                  <Badge key={badge} tone="neutral">
                    {badge}
                  </Badge>
                ))}
              </div>
              <p style={{ margin: '1.5rem 0 0', color: '#94A3B8', fontSize: '0.8rem' }}>
                Risk disclaimer: No guaranteed profits. You can lose money. You stay in control of your exchange account.
              </p>
            </div>
            <div className="landing-hero__visual">
              <Card glass hoverLift className="landing-hero__card">
                <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
                  <Badge tone="primary">Live Telemetry Preview</Badge>
                  <h3 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 600 }}>BTC/USDT Grid</h3>
                </div>
                <div className="hero-visual">
                  <HeroVisualization points={fakeSeries} />
                </div>
                <span style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: '#94A3B8' }}>
                  Telemetry refreshes every 5 seconds · Guard latency &lt; 200ms · 24/7 on-call safety net
                </span>
              </Card>
            </div>
          </Section>

          <Section spacing="5rem 0" id="strategies">
            <div style={{ display: 'grid', gap: '2.5rem' }}>
              <div className="landing-section-intro">
                <Badge tone="primary">Bot lineup</Badge>
                <h2 className="section-heading">Choose the strategy that fits your book</h2>
                <p className="section-subheading">
                  Every bot ships with promotion gates, audit logs, and guard rails that mirror the operator console. Start in paper, then graduate to live when your plan unlocks it.
                </p>
              </div>
              <div className="landing-strategy-grid">
                {strategiesShowcase.map((strategy) => {
                  const plansLower = strategy.plans.toLowerCase();
                  const badgeTone: 'success' | 'secondary' | 'warning' = plansLower.includes('beta')
                    ? 'warning'
                    : plansLower.includes('pro') && !plansLower.includes('starter')
                      ? 'secondary'
                      : 'success';
                  return (
                    <Card key={strategy.id} hoverLift className="landing-strategy-card">
                      <div className="landing-strategy-card__header">
                        <h3 style={{ margin: 0 }}>{strategy.name}</h3>
                        <Badge tone={badgeTone}>{strategy.plans}</Badge>
                      </div>
                      <p style={{ margin: 0, color: '#C7D2FE', fontSize: '1.05rem' }}>{strategy.headline}</p>
                      <p style={{ margin: 0, color: '#94A3B8', lineHeight: 1.7 }}>{strategy.description}</p>
                      <div className="landing-strategy-card__tags">
                        {strategy.highlights.map((item) => (
                          <Badge key={item} tone="neutral">
                            {item}
                          </Badge>
                        ))}
                      </div>
                      <div className="landing-strategy-card__cta">
                        <Link href={`/app?strategy=${strategy.id}`} legacyBehavior>
                          <a>
                            <Button variant="secondary">Preview in dashboard</Button>
                          </a>
                        </Link>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          </Section>

          <Section spacing="5rem 0" id="why">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem', alignItems: 'center' }}>
              <div style={{ textAlign: 'center', maxWidth: '720px' }}>
                <Badge tone="primary">Why OctoBot</Badge>
                <h2 className="section-heading" style={{ marginTop: '1rem' }}>
                  Automation without the blind spots
                </h2>
                <p className="section-subheading" style={{ margin: '0 auto' }}>
                  Every release runs through walk-forward regressions, paper canaries, and manual approval gates. You stay in
                  control while the bots handle execution.
                </p>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '1.5rem',
                  width: '100%',
                }}
              >
                {trustSignals.map((signal) => (
                  <Card key={signal.title} className="landing-feature-card" style={{ height: '100%' }}>
                    <h3 style={{ margin: 0 }}>{signal.title}</h3>
                    <p style={{ margin: '0.75rem 0 0', color: '#94A3B8' }}>{signal.body}</p>
                  </Card>
                ))}
              </div>
            </div>
          </Section>

          <Section spacing="4rem 0">
            <div className="landing-split-grid">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <Badge tone="primary">Built for retail traders</Badge>
                <h2 className="section-heading" style={{ margin: 0 }}>
                  Everything you need to run Binance bots
                </h2>
                <p className="section-subheading" style={{ marginTop: '0.5rem' }}>
                  No enterprise fluff. Connect keys, start in paper, and keep an eye on performance from the same screen.
                </p>
                <div style={{ display: 'grid', gap: '1.3rem' }}>
                  {[
                    'Connect Binance API keys (withdrawals disabled) in under a minute.',
                    'Pick Grid or DCA, set your allocation, and launch in paper mode first.',
                    'Pause or resume from the dashboard whenever you want to change tactics.',
                    'Track every fill and guard event in the Activity tab—no spreadsheets.',
                    'Upgrade to live when you trust the results. No pressure, no lock-in.',
                  ].map((item) => (
                    <div key={item} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                      <Badge tone="primary" style={{ width: '2.5rem', justifyContent: 'center' }}>
                        ✓
                      </Badge>
                      <span style={{ color: '#C7D2FE', fontSize: '1rem' }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Card className="landing-feature-card" style={{ gap: '1.25rem' }} hoverLift>
                <Badge tone="neutral">Transparency &amp; risk</Badge>
                <h3 style={{ margin: 0, fontSize: '1.5rem' }}>Straight talk before you start</h3>
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {[
                    {
                      label: 'No guaranteed profits',
                      body: 'Every strategy can lose money. Use paper mode until you trust what you see.',
                    },
                    {
                      label: 'You stay in control',
                      body: 'We never get withdrawal access. Rotate or delete API keys whenever you want.',
                    },
                    {
                      label: 'Simple billing',
                      body: 'Flat monthly plans. No hidden spreads or “performance” fees.',
                    },
                  ].map((item) => (
                    <div key={item.label}>
                      <p style={{ margin: 0, fontWeight: 600 }}>{item.label}</p>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: '#94A3B8' }}>{item.body}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </Section>

          <div className="section-divider" />

          <Section spacing="5rem 0" id="about" align="center">
            <div style={{ maxWidth: '820px', display: 'grid', gap: '1.5rem' }}>
              <Badge tone="primary">Why OctoBot</Badge>
              <h2 className="section-heading">A small team shipping for other traders</h2>
              <p className="section-subheading" style={{ margin: '0 auto' }}>
                We built OctoBot after getting tired of duct taping spreadsheets, shady bots, and paid signal groups. The goal is simple: one trustworthy place to run bots without giving up custody.
              </p>
              <div className="landing-feature-grid">
                {[
                  {
                    title: 'Retail-focused roadmap',
                    body: 'We obsess over Binance Spot bots first. More venues and strategies come only after the core feels great.',
                  },
                  {
                    title: 'Support that answers',
                    body: 'No helpdesks or fake chat bots. Email us and a builder replies. Plain English, no sales scripts.',
                  },
                  {
                    title: 'Honest risk disclosures',
                    body: 'We remind you that bots can lose money and we cannot touch withdrawals. If that scares you, good—it should.',
                  },
                ].map((item) => (
                  <Card key={item.title} elevation="none" className="landing-feature-card">
                    <h3 style={{ margin: 0 }}>{item.title}</h3>
                    <p style={{ margin: '0.65rem 0 0', color: '#94A3B8' }}>{item.body}</p>
                  </Card>
                ))}
              </div>
            </div>
          </Section>

          <Section spacing="4rem 0" align="center" id="how-it-works">
            <div style={{ maxWidth: '760px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <Badge tone="primary">How it works</Badge>
              <h2 className="section-heading">Three screens and you&apos;re trading</h2>
              <p className="section-subheading" style={{ margin: '0 auto' }}>
                No made-up hedge funds. Just connect Binance, pick a bot, set a budget, and keep watching the feed.
              </p>
            </div>
            <div className="testimonial-row landing-testimonials">
              {onboardingSteps.map((item, idx) => (
                <Card key={item.title} hoverLift style={{ padding: '2rem', animationDelay: `${idx * 0.05}s` }}>
                  <p style={{ fontSize: '1.2rem', margin: 0 }}>{item.title}</p>
                  <p style={{ margin: '0.75rem 0 0', color: '#94A3B8', lineHeight: 1.6 }}>{item.body}</p>
                </Card>
              ))}
            </div>
          </Section>

          <Section spacing="4rem 0" align="center" id="pricing">
            <div style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <Badge tone="primary">Pricing</Badge>
              <h2 className="section-heading">Choose a track and scale at your pace</h2>
              <p className="section-subheading" style={{ margin: '0 auto' }}>
                Straightforward plans. No maker/taker cuts, no performance fees, and you can cancel anytime.
              </p>
            </div>
            <div className="pricing-grid">
              {pricingPlans.map((plan) => (
                <Card
                  key={plan.name}
                  hoverLift
                  className="landing-pricing-card"
                  style={{
                    border: plan.popular ? '1px solid rgba(99,102,241,0.65)' : undefined,
                    transform: plan.popular ? 'translateY(-12px)' : undefined,
                    boxShadow: plan.popular ? '0 35px 70px rgba(99,102,241,0.35)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>{plan.name}</h3>
                    {plan.popular ? <Badge tone="primary">Most popular</Badge> : null}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: '2.4rem', fontWeight: 600 }}>{plan.price}</p>
                    <p style={{ margin: '0.35rem 0 0', color: '#94A3B8' }}>{plan.cadence}</p>
                  </div>
                  <p style={{ color: '#38BDF8', fontSize: '0.9rem', margin: 0 }}>{plan.highlight}</p>
                  <ul className="landing-pricing-features">
                    {plan.features.map((feature) => (
                      <li key={feature} style={{ color: '#E2E8F0' }}>
                        <Badge tone="primary" style={{ width: '1.75rem', justifyContent: 'center' }}>
                          ✓
                        </Badge>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="landing-pricing-cta">
                    <Button fullWidth>{plan.cta}</Button>
                  </div>
                </Card>
              ))}
            </div>
          </Section>

          <Section spacing="4rem 0" id="faq">
            <div className="landing-faq">
              <div style={{ display: 'grid', gap: '1.5rem' }}>
                <Badge tone="primary">FAQ</Badge>
                <h2 className="section-heading" style={{ margin: 0 }}>
                  Answers before you hit deploy
                </h2>
                <p className="section-subheading" style={{ marginTop: '0.5rem' }}>
                  Need something deeper? Send us a note and we&apos;ll walk you through the setup.
                </p>
                <Link href="mailto:hello@octobot.ai" legacyBehavior>
                  <a>
                    <Button variant="secondary">Email hello@octobot.ai</Button>
                  </a>
                </Link>
              </div>
              <div className="faq-grid">
                {faqItems.map((item) => (
                  <Card key={item.question} hoverLift style={{ padding: '1.75rem' }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: '1rem' }}>{item.question}</p>
                    <p style={{ marginTop: '0.75rem', color: '#94A3B8', lineHeight: 1.65 }}>{item.answer}</p>
                  </Card>
                ))}
              </div>
            </div>
          </Section>

          <Section spacing="6rem 0" align="center">
            <Card glass hoverLift className="landing-cta-card" style={{ maxWidth: '780px', margin: '0 auto' }}>
              <div style={{ display: 'grid', gap: '1.5rem' }}>
                <h2 className="section-heading" style={{ margin: 0 }}>
                  Ready to let a bot trade for you?
                </h2>
                <p className="section-subheading" style={{ margin: '0 auto' }}>
                  Connect Binance, launch a paper bot, and watch it in the portal before you risk a single USDT.
                </p>
                <div className="landing-cta-card__actions">
                  <Button>Start in paper mode</Button>
                  <Link href="/legal/tos" legacyBehavior>
                    <a>
                      <Button variant="secondary">Review the docs</Button>
                    </a>
                  </Link>
                </div>
              </div>
            </Card>
          </Section>
        </main>

        <footer className="landing-footer">
          <div className="container landing-footer__inner">
            <div>
              <p style={{ margin: 0, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>OctoBot</p>
              <p style={{ margin: '0.35rem 0 0', color: '#94A3B8', fontSize: '0.85rem' }}>
                © {new Date().getFullYear()} OctoBot. All rights reserved.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <Link href="/legal/tos" legacyBehavior>
                <a style={{ fontSize: '0.85rem', color: '#CBD5F5' }}>Terms</a>
              </Link>
              <Link href="/legal/privacy" legacyBehavior>
                <a style={{ fontSize: '0.85rem', color: '#CBD5F5' }}>Privacy</a>
              </Link>
              <Link href="/app" legacyBehavior>
                <a style={{ fontSize: '0.85rem', color: '#CBD5F5' }}>Portal</a>
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
