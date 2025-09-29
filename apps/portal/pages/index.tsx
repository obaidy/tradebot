import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { HeroVisualization } from '../components/landing/HeroVisualization';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { MetricCard } from '../components/ui/MetricCard';
import { Section } from '../components/ui/Section';
import { callouts, faqItems, metricsPlaceholders, pricingPlans, testimonials } from '../styles/theme';

const metrics = [
  { label: 'Paper win rate', value: metricsPlaceholders.winRate, accent: 'primary' as const },
  { label: 'Active traders', value: metricsPlaceholders.traders, accent: 'secondary' as const },
  { label: 'Managed volume', value: metricsPlaceholders.volume, accent: 'success' as const },
  { label: 'Latency guard', value: metricsPlaceholders.latency, accent: 'warning' as const },
];

const strategiesShowcase = [
  {
    id: 'grid',
    name: 'Grid Bot',
    headline: 'Adaptive mean-reversion engine',
    description:
      'Deploy paper grids in minutes, auto-tune buy/sell levels with regime analysis, and graduate to live once telemetry signs off.',
    plans: 'Starter · Pro',
    highlights: ['Paper + Live', 'BTC / ETH / majors', 'Risk-guarded execution'],
  },
  {
    id: 'mev',
    name: 'MEV Arb Bot',
    headline: 'Flashbots-powered sandwiching',
    description:
      'Monitor mainnet mempools, assemble private bundles, and dispatch through Flashbots with guard rails baked in.',
    plans: 'Pro',
    highlights: ['Flashbots relay ready', 'Live only', 'Private key isolation'],
  },
  {
    id: 'momentum',
    name: 'Momentum Scout',
    headline: 'Trend-following with volatility filters',
    description:
      'Ride intraday breakouts while dynamic trailing stops and volatility guards protect against sharp reversals.',
    plans: 'Pro (beta)',
    highlights: ['Paper + Live', 'Multi-venue routing', 'Adaptive risk sizing'],
  },
  {
    id: 'dca',
    name: 'DCA Accumulator',
    headline: 'Systematic dollar-cost averaging',
    description:
      'Automate treasury accumulation across majors with configurable cadence, slippage controls, and guardrail alerts.',
    plans: 'Starter · Pro',
    highlights: ['Paper + Live', 'Schedule based', 'Escalation alerts'],
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
          <Section spacing="6rem 0" id="hero">
            <div
              style={{
                display: 'grid',
                gap: '2.5rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2.4rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <Badge tone="primary">OctoBot Control Plane</Badge>
                  <h1 className="section-heading gradient-text" style={{ margin: 0 }}>
                    {callouts.hero.headline}
                  </h1>
                  <p className="section-subheading" style={{ color: '#CBD5F5', margin: 0 }}>
                    {callouts.hero.subheadline}
                  </p>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                  {callouts.hero.trustBadges.map((badge) => (
                    <Badge key={badge} tone="neutral">
                      {badge}
                    </Badge>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <Card glass hoverLift style={{ padding: '2rem', background: 'rgba(17,24,39,0.6)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
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
            </div>
          </Section>

          <Section spacing="5rem 0" id="strategies">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
              <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto', display: 'grid', gap: '1rem' }}>
                <Badge tone="primary">Bot lineup</Badge>
                <h2 className="section-heading">Choose the strategy that fits your book</h2>
                <p className="section-subheading">
                  Every bot ships with promotion gates, audit logs, and guard rails that mirror the operator console. Start in paper, then graduate to live when your plan unlocks it.
                </p>
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: '1.5rem',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                }}
              >
                {strategiesShowcase.map((strategy) => {
                  const plansLower = strategy.plans.toLowerCase();
                  const badgeTone: 'success' | 'secondary' | 'warning' = plansLower.includes('beta')
                    ? 'warning'
                    : plansLower.includes('pro') && !plansLower.includes('starter')
                      ? 'secondary'
                      : 'success';
                  return (
                    <Card key={strategy.id} hoverLift style={{ padding: '2rem', display: 'grid', gap: '1.3rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0 }}>{strategy.name}</h3>
                        <Badge tone={badgeTone}>{strategy.plans}</Badge>
                      </div>
                      <p style={{ margin: 0, color: '#C7D2FE', fontSize: '1.05rem' }}>{strategy.headline}</p>
                      <p style={{ margin: 0, color: '#94A3B8', lineHeight: 1.7 }}>{strategy.description}</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {strategy.highlights.map((item) => (
                          <Badge key={item} tone="neutral">
                            {item}
                          </Badge>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
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
              <div className="metrics-grid">
                {metrics.map((metric) => (
                  <MetricCard key={metric.label} label={metric.label} value={metric.value} accent={metric.accent} />
                ))}
              </div>
            </div>
          </Section>

          <Section spacing="4rem 0">
            <div
              style={{
                display: 'grid',
                gap: '3rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                alignItems: 'start',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <Badge tone="primary">Release pipeline, operationalized</Badge>
                <h2 className="section-heading" style={{ margin: 0 }}>
                  From idea to live trading in a single workflow
                </h2>
                <p className="section-subheading" style={{ marginTop: '0.5rem' }}>
                  We orchestrate walk-forward regressions, paper canaries, live promotion gates, billing automation, and audit
                  logs out of the box. Launch, monitor, and adapt without duct tape.
                </p>
                <div style={{ display: 'grid', gap: '1.3rem' }}>
                  {[
                    'Set up strategy templates and guard policies',
                    'Run automatic walk-forward regression suites per release',
                    'Capture paper canary telemetry before human approval',
                    'Promote live with one click once metrics sign off',
                    'Monitor real-time dashboards and alerting queues',
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
              <Card style={{ display: 'grid', gap: '1.25rem', padding: '2rem' }} hoverLift>
                <Badge tone="neutral">Release readiness</Badge>
                <h3 style={{ margin: 0, fontSize: '1.5rem' }}>Milestone 7 · Paper Canary Passed</h3>
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {[
                    { label: 'Walk-forward regression', status: 'passed', tone: 'success' },
                    { label: 'Paper canary deployment', status: 'passed', tone: 'success' },
                    { label: 'Live promotion gate', status: 'awaiting approval', tone: 'primary' },
                    { label: 'Client comms prepared', status: 'ready', tone: 'neutral' },
                  ].map((item) => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 600 }}>{item.label}</p>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#94A3B8' }}>Automated checks complete</p>
                      </div>
                      <Badge tone={item.tone as any}>{item.status}</Badge>
                    </div>
                  ))}
                </div>
                <Card glass={false} elevation="none" style={{ padding: '1rem', background: 'rgba(8,47,73,0.35)' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#38BDF8' }}>Next slot: Tuesday 14:00 UTC</p>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#94A3B8' }}>
                    Stakeholders notified. Paper run telemetry attached in release artefacts.
                  </p>
                </Card>
              </Card>
            </div>
          </Section>

          <div className="section-divider" />

          <Section spacing="5rem 0" id="about" align="center">
            <div style={{ maxWidth: '820px', display: 'grid', gap: '1.5rem' }}>
              <Badge tone="primary">About OctoBot</Badge>
              <h2 className="section-heading">Built by operators, for operators</h2>
              <p className="section-subheading" style={{ margin: '0 auto' }}>
                We are an ops-obsessed team of ex-quant traders and SREs. Every feature ships after living in our own desks—telemetry, guard rails, billing, and release artefacts included.
              </p>
              <div
                style={{
                  display: 'grid',
                  gap: '1rem',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                }}
              >
                {[
                  {
                    title: 'Operator-first design',
                    body: 'Dashboards, alerts, and approvals mirror real desks so your team can adopt without retraining.',
                  },
                  {
                    title: 'Security baked in',
                    body: 'Hardware key support, secret rotation, and private bundle routing keep keys off shared hosts.',
                  },
                  {
                    title: 'Human-in-the-loop',
                    body: 'Promotion gates ensure no strategy graduates to live without explicit human approval.',
                  },
                ].map((item) => (
                  <Card key={item.title} elevation="none" style={{ padding: '1.75rem', background: 'rgba(17,24,39,0.65)' }}>
                    <h3 style={{ margin: 0 }}>{item.title}</h3>
                    <p style={{ margin: '0.65rem 0 0', color: '#94A3B8' }}>{item.body}</p>
                  </Card>
                ))}
              </div>
            </div>
          </Section>

          <Section spacing="4rem 0" align="center" id="pricing">
            <div style={{ maxWidth: '760px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <Badge tone="primary">What operators say</Badge>
              <h2 className="section-heading">Trusted by systematic trading desks</h2>
              <p className="section-subheading" style={{ margin: '0 auto' }}>
                Power users lean on OctoBot to launch, monitor, and audit dozens of strategies without scaling engineering
                headcount.
              </p>
            </div>
            <div className="testimonial-row">
              {testimonials.map((item, idx) => (
                <Card key={item.name} hoverLift style={{ padding: '2rem', animationDelay: `${idx * 0.1}s` }}>
                  <p style={{ fontSize: '1.05rem', lineHeight: 1.7, color: '#E2E8F0' }}>“{item.quote}”</p>
                  <div style={{ marginTop: '1.5rem' }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>{item.name}</p>
                    <p style={{ margin: '0.35rem 0 0', color: '#94A3B8', fontSize: '0.85rem' }}>{item.role}</p>
                  </div>
                </Card>
              ))}
            </div>
          </Section>

          <Section spacing="4rem 0" align="center">
            <div style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <Badge tone="primary">Pricing</Badge>
              <h2 className="section-heading">Choose a track and scale at your pace</h2>
              <p className="section-subheading" style={{ margin: '0 auto' }}>
                Transparent pricing with automated billing, release artefacts, and 24/7 telemetry included. No hidden maker/taker
                spreads.
              </p>
            </div>
            <div className="pricing-grid">
              {pricingPlans.map((plan) => (
                <Card
                  key={plan.name}
                  hoverLift
                  style={{
                    border: plan.popular ? '1px solid rgba(99,102,241,0.65)' : undefined,
                    transform: plan.popular ? 'translateY(-12px)' : undefined,
                    boxShadow: plan.popular ? '0 35px 70px rgba(99,102,241,0.35)' : undefined,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.2rem',
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
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.8rem' }}>
                    {plan.features.map((feature) => (
                      <li key={feature} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', color: '#E2E8F0' }}>
                        <Badge tone="primary" style={{ width: '1.75rem', justifyContent: 'center' }}>
                          ✓
                        </Badge>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button fullWidth>{plan.cta}</Button>
                </Card>
              ))}
            </div>
          </Section>

          <Section spacing="4rem 0" id="faq">
            <div
              style={{
                display: 'grid',
                gap: '3rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                alignItems: 'start',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <Badge tone="primary">FAQ</Badge>
                <h2 className="section-heading" style={{ margin: 0 }}>
                  Answers before you hit deploy
                </h2>
                <p className="section-subheading" style={{ marginTop: '0.5rem' }}>
                  Need something deeper? Book a session with our operations team and we’ll tailor the onboarding journey to your
                  desk.
                </p>
                <Link href="mailto:hello@octobot.ai" legacyBehavior>
                  <a>
                    <Button variant="secondary">Talk to an Operator</Button>
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
            <Card glass hoverLift style={{ padding: '3rem', maxWidth: '780px', margin: '0 auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <h2 className="section-heading" style={{ margin: 0 }}>
                  Step into the command center
                </h2>
                <p className="section-subheading" style={{ margin: '0 auto' }}>
                  Monitor live strategies, edit guardrails, approve releases, and handle billing from a single workspace.
                </p>
                <div style={{ display: 'inline-flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Button>Join the Beta List</Button>
                  <Link href="/legal/tos" legacyBehavior>
                    <a>
                      <Button variant="secondary">View Compliance Docs</Button>
                    </a>
                  </Link>
                </div>
              </div>
            </Card>
          </Section>
        </main>

        <footer style={{ borderTop: '1px solid rgba(148,163,184,0.12)', background: 'rgba(5,8,22,0.8)', padding: '2rem 0' }}>
          <div
            className="container"
            style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1.5rem' }}
          >
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
