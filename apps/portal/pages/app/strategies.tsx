import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { palette, typography } from '../../styles/theme';

type StrategyRequirement = {
  type: 'env';
  keys: string[];
  message?: string;
  mode?: 'all' | 'any';
};

type StrategySummary = {
  id: string;
  name: string;
  description: string;
  allowedPlans: string[];
  defaultPair: string;
  supportsPaper: boolean;
  supportsLive: boolean;
  supportsSummary: boolean;
  status: 'active' | 'beta' | 'coming_soon';
  ctaLabel?: string;
  ctaDescription?: string;
  requirements?: StrategyRequirement[];
};

const statusTone: Record<StrategySummary['status'], 'success' | 'secondary' | 'neutral'> = {
  active: 'success',
  beta: 'secondary',
  coming_soon: 'neutral',
};

function formatStatus(status: StrategySummary['status']) {
  switch (status) {
    case 'active':
      return 'Active';
    case 'beta':
      return 'Beta';
    case 'coming_soon':
    default:
      return 'Coming soon';
  }
}

function RequirementList({ requirements }: { requirements?: StrategyRequirement[] }) {
  if (!requirements?.length) {
    return (
      <p style={{ margin: 0, color: palette.textSecondary, fontSize: '0.85rem' }}>
        No special runtime requirements.
      </p>
    );
  }
  return (
    <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.25rem', color: palette.textSecondary, fontSize: '0.85rem' }}>
      {requirements.map((req, index) => (
        <li key={index}>
          {req.message ?? `Requires ${req.mode === 'any' ? 'one of' : 'all of'}: ${req.keys.join(', ')}`}
        </li>
      ))}
    </ul>
  );
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<StrategySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/client/strategies');
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const payload = (await res.json()) as StrategySummary[];
        if (!cancelled) {
          setStrategies(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load strategies.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const orderedStrategies = useMemo(() => {
    return strategies.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [strategies]);

  return (
    <DashboardLayout>
      <Head>
        <title>Strategies · OctoBot Operator Console</title>
      </Head>

      <header style={{ marginBottom: '2rem' }}>
        <p
          style={{
            margin: 0,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontSize: '0.75rem',
            color: palette.textSecondary,
          }}
        >
          Strategy catalog
        </p>
        <h1
          style={{
            margin: '0.35rem 0 0',
            fontSize: '2rem',
            letterSpacing: '-0.01em',
            fontFamily: typography.fontFamily,
          }}
        >
          Deployable playbooks
        </h1>
        <p style={{ margin: '0.75rem 0 0', maxWidth: '52rem', color: palette.textSecondary }}>
          Review the bots in the current release. Each entry lists live &amp; paper support, plan access, and any
          runtime requirements before activation. Use the overview screen to allocate capital once you are ready.
        </p>
      </header>

      {loading ? (
        <Card style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <p style={{ margin: 0, color: palette.textSecondary }}>Loading strategies…</p>
        </Card>
      ) : error ? (
        <Card style={{ background: 'rgba(127, 29, 29, 0.18)', border: '1px solid rgba(248, 113, 113, 0.32)' }}>
          <h2 style={{ marginTop: 0, color: '#fca5a5' }}>Unable to load strategy catalog</h2>
          <p style={{ color: '#fecaca' }}>{error}</p>
          <p style={{ fontSize: '0.85rem', color: palette.textSecondary }}>
            Check the admin API credentials and ensure the tradebot API is reachable from the portal environment.
          </p>
        </Card>
      ) : orderedStrategies.length === 0 ? (
        <Card>
          <h2 style={{ marginTop: 0 }}>No strategies available</h2>
          <p style={{ color: palette.textSecondary }}>
            The admin API returned an empty catalog. Double-check plan configuration and ensure your client has access
            to at least one strategy.
          </p>
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1.75rem',
          }}
        >
          {orderedStrategies.map((strategy) => (
            <Card key={strategy.id} hoverLift>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.35rem' }}>{strategy.name}</h2>
                  <p style={{ margin: '0.5rem 0', color: palette.textSecondary }}>{strategy.description}</p>
                </div>
                <Badge tone={statusTone[strategy.status]}>{formatStatus(strategy.status)}</Badge>
              </div>

              <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div>
                  <strong>Supports:</strong>{' '}
                  <span style={{ color: palette.textSecondary }}>
                    {strategy.supportsPaper ? 'Paper' : null}
                    {strategy.supportsPaper && strategy.supportsLive ? ' · ' : ''}
                    {strategy.supportsLive ? 'Live' : null}
                    {!(strategy.supportsPaper || strategy.supportsLive) ? 'Summary only' : ''}
                  </span>
                </div>
                <div>
                  <strong>Default pair:</strong>{' '}
                  <span style={{ color: palette.textSecondary }}>{strategy.defaultPair}</span>
                </div>
                <div>
                  <strong>Allowed plans:</strong>{' '}
                  <span style={{ color: palette.textSecondary }}>
                    {strategy.allowedPlans.length ? strategy.allowedPlans.join(', ') : 'Not yet assigned'}
                  </span>
                </div>
                <div>
                  <strong>Runtime requirements:</strong>
                  <RequirementList requirements={strategy.requirements} />
                </div>
              </div>

              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    window.open(`/app?focus=${strategy.id}`, '_self');
                  }}
                  disabled={strategy.status === 'coming_soon'}
                >
                  Manage allocation
                </Button>
                {strategy.ctaLabel ? (
                  <Link href="/app" legacyBehavior>
                    <a style={{ fontSize: '0.85rem', color: palette.primary }}>{strategy.ctaLabel}</a>
                  </Link>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
