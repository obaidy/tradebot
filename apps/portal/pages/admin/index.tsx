import Head from 'next/head';
import { signOut, useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable, Column, SortState } from '../../components/ui/DataTable';
import { HeroVisualization } from '../../components/landing/HeroVisualization';
import { MetricCard } from '../../components/ui/MetricCard';
import { useTableControls } from '../../components/ui/useTableControls';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.json().catch((parseError) => {
      console.error('[portal-admin] Failed to parse error response', parseError);
      return {};
    });
    throw new Error(detail.error || `Request failed (${res.status})`);
  }
  return res.json();
}

interface BillingRow {
  id: string;
  plan: string;
  status: string;
  trialEndsAt: string | null;
  autoPaused: boolean;
  isPaused: boolean;
  killRequested: boolean;
}

interface SummaryRow {
  id: string;
  plan: string;
  billingStatus: string;
  autoPaused: boolean;
  isPaused: boolean;
  guard: { global_pnl: number; run_pnl: number };
  workers: Record<string, number>;
  runs: { runs: number; last_started: string | null };
}

interface SummaryResponse {
  totalClients: number;
  pausedClients: number;
  billingIssues: number;
  data: SummaryRow[];
}

interface StrategyCatalogEntry {
  id: string;
  name: string;
  description: string;
  supportsPaper: boolean;
  supportsLive: boolean;
}

interface PortfolioAllocationSummary {
  strategyId: string;
  weightPct: number;
  maxRiskPct?: number | null;
  runMode?: string | null;
  enabled: boolean;
  config?: Record<string, unknown> | null;
  updatedAt: string;
}

interface PortfolioPlanEntry {
  strategyId: string;
  requestedRunMode: string;
  finalRunMode: string;
  weightPct: number;
  normalizedWeightPct: number;
  bankrollUsd: number;
  allocationUsd: number;
  maxRiskUsd?: number | null;
  enabled: boolean;
  reason?: string | null;
}

interface PortfolioPlanSummary {
  entries?: PortfolioPlanEntry[];
  totalRequestedWeightPct?: number;
  normalized?: boolean;
}

interface PortfolioResponse {
  allocations: PortfolioAllocationSummary[];
  totalWeightPct: number;
  plan?: PortfolioPlanSummary | null;
}

interface PortfolioAllocationForm {
  strategyId: string;
  weightPct: string;
  maxRiskPct: string;
  runMode: string;
  enabled: boolean;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export default function AdminDashboard() {
  const { data: session } = useSession();
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [billing, setBilling] = useState<BillingRow[]>([]);
  const [strategyCatalog, setStrategyCatalog] = useState<StrategyCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedSummaryView, setSelectedSummaryView] = useState('');
  const [selectedBillingView, setSelectedBillingView] = useState('');
  const [selectedPortfolioClient, setSelectedPortfolioClient] = useState('');
  const [portfolioAllocations, setPortfolioAllocations] = useState<PortfolioAllocationSummary[]>([]);
  const [portfolioPlan, setPortfolioPlan] = useState<PortfolioPlanSummary | null>(null);
  const [portfolioDraft, setPortfolioDraft] = useState<PortfolioAllocationForm[]>([]);
  const [portfolioDirty, setPortfolioDirty] = useState(false);
  const [portfolioSaving, setPortfolioSaving] = useState(false);
  const [portfolioMessage, setPortfolioMessage] = useState<string | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [summaryRes, billingRes, strategiesRes] = await Promise.all([
        fetchJson<SummaryResponse>('/api/admin/summary'),
        fetchJson<BillingRow[]>('/api/admin/billing'),
        fetchJson<StrategyCatalogEntry[]>('/api/admin/strategies'),
      ]);
      setSummary(summaryRes);
      setBilling(billingRes);
      setStrategyCatalog(strategiesRes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadClientPortfolio = useCallback(
    async (clientId: string) => {
      if (!clientId) return;
      try {
        setPortfolioError(null);
        setPortfolioMessage(null);
        const portfolio = await fetchJson<PortfolioResponse>(
          `/api/admin/clients/${encodeURIComponent(clientId)}/portfolio`
        );
        setPortfolioAllocations(portfolio?.allocations ?? []);
        setPortfolioPlan(portfolio?.plan ?? null);
        setPortfolioDraft(
          (portfolio?.allocations ?? []).map((allocation) => ({
            strategyId: allocation.strategyId,
            weightPct: allocation.weightPct.toString(),
            maxRiskPct:
              allocation.maxRiskPct != null && Number.isFinite(allocation.maxRiskPct)
                ? allocation.maxRiskPct.toString()
                : '',
            runMode: allocation.runMode ?? '',
            enabled: allocation.enabled,
          }))
        );
        setPortfolioDirty(false);
      } catch (err) {
        setPortfolioAllocations([]);
        setPortfolioPlan(null);
        setPortfolioDraft([]);
        setPortfolioDirty(false);
        setPortfolioError(err instanceof Error ? err.message : 'Failed to load portfolio');
      }
    },
    []
  );

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60_000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    if (!summary?.data?.length) return;
    if (!selectedPortfolioClient) {
      setSelectedPortfolioClient(summary.data[0].id);
    }
  }, [summary, selectedPortfolioClient]);

  useEffect(() => {
    if (selectedPortfolioClient) {
      loadClientPortfolio(selectedPortfolioClient);
    } else {
      setPortfolioAllocations([]);
      setPortfolioPlan(null);
      setPortfolioDraft([]);
      setPortfolioDirty(false);
      setPortfolioError(null);
      setPortfolioMessage(null);
    }
  }, [selectedPortfolioClient, loadClientPortfolio]);

  const trendPoints = useMemo(() => {
    if (!summary?.data?.length) return null;
    return summary.data.map((row) => row.guard.global_pnl);
  }, [summary]);

  const metricsCards = useMemo(
    () => [
      {
        label: 'Total clients',
        value: summary ? String(summary.totalClients) : '0',
        footer: 'All onboarded client IDs',
        accent: 'primary' as const,
      },
      {
        label: 'Paused clients',
        value: summary ? String(summary.pausedClients) : '0',
        footer: 'Currently halted by operators',
        accent: 'secondary' as const,
      },
      {
        label: 'Billing alerts',
        value: summary ? String(summary.billingIssues) : '0',
        footer: 'Trials expired or payment failures',
        accent: 'warning' as const,
      },
    ],
    [summary]
  );

  const summaryColumns = useMemo<Column<SummaryRow>[]>(
    () => [
      {
        key: 'id',
        header: 'Client',
        sortable: true,
        render: (row) => row.id,
      },
      {
        key: 'plan',
        header: 'Plan',
        sortable: true,
        render: (row) => row.plan,
      },
      {
        key: 'billingStatus',
        header: 'Billing status',
        sortable: true,
        render: (row) => row.billingStatus,
      },
      {
        key: 'autoPaused',
        header: 'Auto paused',
        sortable: true,
        sortAccessor: (row) => (row.autoPaused ? 1 : 0),
        render: (row) => (row.autoPaused ? 'Yes' : 'No'),
      },
      {
        key: 'guard',
        header: 'PnL',
        sortable: true,
        sortAccessor: (row) => row.guard.global_pnl,
        render: (row) => `Global $${row.guard.global_pnl.toFixed(2)} · Run $${row.guard.run_pnl.toFixed(2)}`,
      },
      {
        key: 'workers',
        header: 'Workers',
        sortable: true,
        sortAccessor: (row) => Object.values(row.workers).reduce((acc, value) => acc + value, 0),
        render: (row) =>
          Object.keys(row.workers).length === 0
            ? '—'
            : Object.entries(row.workers)
                .map(([status, count]) => `${status}: ${count}`)
                .join(', '),
      },
      {
        key: 'runs',
        header: 'Runs',
        sortable: true,
        sortAccessor: (row) => row.runs.runs,
        render: (row) =>
          `${row.runs.runs} runs${row.runs.last_started ? ` · ${new Date(row.runs.last_started).toLocaleString()}` : ''}`,
      },
    ],
    []
  );

  const billingColumns = useMemo<Column<BillingRow>[]>(
    () => [
      {
        key: 'id',
        header: 'Client',
        sortable: true,
        render: (row) => row.id,
      },
      {
        key: 'plan',
        header: 'Plan',
        sortable: true,
        render: (row) => row.plan,
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        render: (row) => row.status,
      },
      {
        key: 'trialEndsAt',
        header: 'Trial ends',
        sortable: true,
        sortAccessor: (row) => (row.trialEndsAt ? new Date(row.trialEndsAt) : null),
        render: (row) => formatDate(row.trialEndsAt),
      },
      {
        key: 'autoPaused',
        header: 'Auto paused',
        sortable: true,
        sortAccessor: (row) => (row.autoPaused ? 1 : 0),
        render: (row) => (row.autoPaused ? 'Yes' : 'No'),
      },
      {
        key: 'isPaused',
        header: 'Paused',
        sortable: true,
        sortAccessor: (row) => (row.isPaused ? 1 : 0),
        render: (row) => (row.isPaused ? 'Yes' : 'No'),
      },
      {
        key: 'killRequested',
        header: 'Kill requested',
        sortable: true,
        sortAccessor: (row) => (row.killRequested ? 1 : 0),
        render: (row) => (row.killRequested ? 'Yes' : 'No'),
      },
    ],
    []
  );

  const totalDraftWeight = useMemo(() => {
    return portfolioDraft
      .filter((row) => row.enabled)
      .reduce((sum, row) => sum + (Number(row.weightPct) || 0), 0);
  }, [portfolioDraft]);

  const planEntries = useMemo(() => portfolioPlan?.entries ?? [], [portfolioPlan]);

  const planActiveWeight = useMemo(() => {
    return planEntries.filter((entry) => entry.enabled).reduce((sum, entry) => sum + entry.normalizedWeightPct, 0);
  }, [planEntries]);

  const formatStrategyName = useCallback(
    (strategyId: string) => {
      const match = strategyCatalog.find((entry) => entry.id === strategyId);
      return match?.name ?? strategyId;
    },
    [strategyCatalog]
  );

  const updateDraft = useCallback((index: number, updater: (prev: PortfolioAllocationForm) => PortfolioAllocationForm) => {
    setPortfolioDraft((prev) => {
      const next = [...prev];
      next[index] = updater(next[index]);
      return next;
    });
    setPortfolioDirty(true);
    setPortfolioMessage(null);
    setPortfolioError(null);
  }, []);

  const handlePortfolioClientChange = (value: string) => {
    setSelectedPortfolioClient(value);
    setPortfolioMessage(null);
    setPortfolioError(null);
  };

  const handleAllocationFieldChange = (index: number, field: keyof PortfolioAllocationForm, value: string | boolean) => {
    updateDraft(index, (prev) => ({
      ...prev,
      [field]: field === 'enabled' ? Boolean(value) : String(value),
    }));
  };

  const handleRemoveAllocation = (index: number) => {
    setPortfolioDraft((prev) => prev.filter((_, idx) => idx !== index));
    setPortfolioDirty(true);
    setPortfolioMessage(null);
  };

  const handleAddAllocation = () => {
    if (!strategyCatalog.length) {
      setPortfolioError('No strategies available to allocate.');
      return;
    }
    const used = new Set(portfolioDraft.map((row) => row.strategyId));
    const candidate = strategyCatalog.find((entry) => !used.has(entry.id)) ?? strategyCatalog[0];
    setPortfolioDraft((prev) => [
      ...prev,
      {
        strategyId: candidate.id,
        weightPct: '0',
        maxRiskPct: '',
        runMode: '',
        enabled: true,
      },
    ]);
    setPortfolioDirty(true);
    setPortfolioMessage(null);
  };

  const handleResetPortfolio = () => {
    if (selectedPortfolioClient) {
      loadClientPortfolio(selectedPortfolioClient);
    }
  };

  const handleSavePortfolio = async () => {
    if (!selectedPortfolioClient) {
      setPortfolioError('Select a client before saving.');
      return;
    }
    const payloadAllocations = portfolioDraft.map((row) => ({
      strategyId: row.strategyId,
      weightPct: Number(row.weightPct),
      maxRiskPct: row.maxRiskPct ? Number(row.maxRiskPct) : null,
      runMode: row.runMode ? row.runMode : null,
      enabled: row.enabled,
    }));

    for (const allocation of payloadAllocations) {
      if (!allocation.strategyId) {
        setPortfolioError('Each allocation must specify a strategy.');
        return;
      }
      if (!Number.isFinite(allocation.weightPct) || allocation.weightPct < 0) {
        setPortfolioError('Weights must be non-negative numbers.');
        return;
      }
      if (
        allocation.maxRiskPct != null &&
        (!Number.isFinite(allocation.maxRiskPct) || allocation.maxRiskPct < 0)
      ) {
        setPortfolioError('Risk caps must be non-negative numbers.');
        return;
      }
      if (allocation.runMode && !['live', 'paper', 'summary'].includes(allocation.runMode)) {
        setPortfolioError('Run mode must be live, paper, or summary.');
        return;
      }
    }

    const enabledWeight = payloadAllocations
      .filter((allocation) => allocation.enabled)
      .reduce((sum, allocation) => sum + allocation.weightPct, 0);
    if (enabledWeight <= 0) {
      setPortfolioError('Total enabled weight must be greater than zero.');
      return;
    }

    const seen = new Set<string>();
    for (const allocation of payloadAllocations) {
      if (seen.has(allocation.strategyId)) {
        setPortfolioError('Each strategy can only appear once.');
        return;
      }
      seen.add(allocation.strategyId);
    }

    setPortfolioSaving(true);
    setPortfolioMessage(null);
    setPortfolioError(null);
    try {
      const res = await fetch(`/api/admin/clients/${encodeURIComponent(selectedPortfolioClient)}/portfolio`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocations: payloadAllocations }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'Failed to update portfolio');
      }
      const data = (await res.json()) as PortfolioResponse;
      setPortfolioAllocations(data.allocations ?? []);
      setPortfolioPlan(data.plan ?? null);
      setPortfolioDraft(
        (data.allocations ?? []).map((allocation) => ({
          strategyId: allocation.strategyId,
          weightPct: allocation.weightPct.toString(),
          maxRiskPct:
            allocation.maxRiskPct != null && Number.isFinite(allocation.maxRiskPct)
              ? allocation.maxRiskPct.toString()
              : '',
          runMode: allocation.runMode ?? '',
          enabled: allocation.enabled,
        }))
      );
      setPortfolioDirty(false);
      setPortfolioMessage('Portfolio updated successfully.');
    } catch (err) {
      setPortfolioError(err instanceof Error ? err.message : 'Failed to update portfolio');
    } finally {
      setPortfolioSaving(false);
    }
  };

  const summaryTable = useTableControls(summary?.data ?? [], {
    columns: summaryColumns,
    initialSort: [{ columnKey: 'guard', direction: 'desc' }],
    filterFn: (row, query) =>
      row.id.toLowerCase().includes(query) ||
      row.plan.toLowerCase().includes(query) ||
      row.billingStatus.toLowerCase().includes(query),
    storageKey: 'admin.summary.views',
  });

  const billingTable = useTableControls(billing, {
    columns: billingColumns,
    initialSort: [{ columnKey: 'status', direction: 'asc' }],
    filterFn: (row, query) =>
      row.id.toLowerCase().includes(query) ||
      row.plan.toLowerCase().includes(query) ||
      row.status.toLowerCase().includes(query),
    storageKey: 'admin.billing.views',
  });

  const getColumnLabel = useCallback((columns: Column<any>[], key: string) => {
    const column = columns.find((col) => col.key === key);
    if (!column) return key;
    const header = column.header;
    return typeof header === 'string' || typeof header === 'number' ? String(header) : column.key;
  }, []);

  const requestCsvExport = useCallback(
    async (dataset: string, headers: string[], rows: Array<Array<string | number | null>>) => {
      try {
        const response = await fetch('/api/client/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataset, headers, rows }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || 'export_failed');
        }
        if (payload.url) {
          window.open(payload.url, '_blank');
          setMessage(`Export ready at ${payload.location}`);
          return;
        }
        if (payload.inline && typeof window !== 'undefined') {
          const binary = window.atob(String(payload.inline));
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `${dataset}.csv`;
          anchor.click();
          URL.revokeObjectURL(url);
          setMessage('Export downloaded');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'export_failed');
      }
    },
    []
  );

  const handleSummaryExport = () =>
    requestCsvExport(
      'admin-summary',
      ['Client', 'Plan', 'Billing', 'Auto paused', 'Global PnL', 'Run PnL', 'Workers', 'Runs'],
      summaryTable.rows.map((row) => [
        row.id,
        row.plan,
        row.billingStatus,
        row.autoPaused ? 'Yes' : 'No',
        row.guard.global_pnl.toFixed(2),
        row.guard.run_pnl.toFixed(2),
        Object.entries(row.workers)
          .map(([status, count]) => `${status}:${count}`)
          .join(' '),
        row.runs.runs,
      ])
    );

  const handleBillingExport = () =>
    requestCsvExport(
      'admin-billing',
      ['Client', 'Plan', 'Status', 'Trial ends', 'Auto paused', 'Paused', 'Kill requested'],
      billingTable.rows.map((row) => [
        row.id,
        row.plan,
        row.status,
        row.trialEndsAt ? new Date(row.trialEndsAt).toLocaleString() : '',
        row.autoPaused ? 'Yes' : 'No',
        row.isPaused ? 'Yes' : 'No',
        row.killRequested ? 'Yes' : 'No',
      ])
    );

  const topRightSlot = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <div style={{ textAlign: 'right' }}>
        <p style={{ margin: 0, fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94A3B8' }}>
          Signed in as
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{session?.user?.email ?? session?.user?.id ?? 'operator'}</p>
      </div>
      <Button variant="ghost" onClick={() => signOut({ callbackUrl: '/' })}>
        Sign out
      </Button>
    </div>
  );

  if (loading) {
    return (
      <DashboardLayout topRightSlot={topRightSlot}>
        <Card style={{ textAlign: 'center' }}>Loading operations dashboard…</Card>
      </DashboardLayout>
    );
  }

  return (
    <>
      <Head>
        <title>OctoBot · Admin Console</title>
      </Head>
      <DashboardLayout topRightSlot={topRightSlot}>
        <div style={{ display: 'grid', gap: '1.75rem' }}>
          {error ? (
            <Card elevation="none" glass style={{ border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(127,29,29,0.25)' }}>
              {error}
            </Card>
          ) : null}
          {message ? (
            <Card elevation="none" glass style={{ border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.12)' }}>
              {message}
            </Card>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ margin: 0 }}>Operations dashboard</h1>
              <p style={{ margin: 0, color: '#94A3B8' }}>Monitor fleet health, billing posture, and guard telemetry.</p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={() => (window.location.href = '/admin/support')}>
                Support inbox
              </Button>
              <Button variant="ghost" onClick={loadData}>
                Refresh now
              </Button>
            </div>
          </div>

          {trendPoints && trendPoints.length > 0 ? (
            <Card
              hoverLift
              style={{
                gridColumn: '1 / -1',
                padding: '2rem',
                display: 'grid',
                gap: '1.5rem',
                background: 'linear-gradient(135deg, rgba(14,165,233,0.25), rgba(14,116,144,0.25))',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <Badge tone="primary">Global telemetry</Badge>
                  <h2 style={{ margin: '0.85rem 0 0' }}>Portfolio momentum</h2>
                  <p style={{ margin: 0, color: '#CFE5FF', maxWidth: 520 }}>
                    Aggregated global P&L across clients. Use this as your north star before greenlighting live promotions.
                  </p>
                </div>
                <div style={{ textAlign: 'right', minWidth: 180 }}>
                  <p style={{ margin: 0, color: '#bbf7d0', fontSize: '0.85rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Latest global P&L
                  </p>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '1.65rem', fontWeight: 700 }}>
                    {summary?.data?.length ? `$${summary.data[0].guard.global_pnl.toFixed(2)}` : '—'}
                  </p>
                </div>
              </div>
              <div className="dashboard-hero">
                <HeroVisualization points={trendPoints} />
              </div>
            </Card>
          ) : null}

          <div className="metrics-grid">
            {metricsCards.map((metric) => (
              <MetricCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                footer={metric.footer}
                accent={metric.accent}
              />
            ))}
          </div>

          <Card style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <Badge tone="primary">Portfolio controls</Badge>
              <h2 style={{ margin: '0.75rem 0 0' }}>Edit strategy allocations</h2>
              <p style={{ color: '#94A3B8', margin: 0 }}>
                Adjust weights, risk caps, and run modes for each client. Changes apply on the next job dispatch.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
              <label style={{ fontSize: '0.85rem', color: '#94A3B8' }}>
                Client
                <select
                  value={selectedPortfolioClient}
                  onChange={(event) => handlePortfolioClientChange(event.target.value)}
                  style={{
                    display: 'block',
                    minWidth: 220,
                    marginTop: '0.35rem',
                    padding: '0.55rem 0.75rem',
                    borderRadius: 10,
                    border: '1px solid rgba(148,163,184,0.2)',
                    background: 'rgba(8,13,25,0.75)',
                    color: '#E2E8F0',
                  }}
                >
                  <option value="">Select client</option>
                  {summary?.data?.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.id} · {row.plan}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                <Button variant="ghost" onClick={handleAddAllocation} disabled={!selectedPortfolioClient || !strategyCatalog.length}>
                  Add allocation
                </Button>
                <Button variant="ghost" onClick={handleResetPortfolio} disabled={!selectedPortfolioClient || portfolioSaving}>
                  Reset
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSavePortfolio}
                  disabled={!selectedPortfolioClient || portfolioSaving || !portfolioDirty}
                >
                  {portfolioSaving ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </div>
            {portfolioMessage ? (
              <Card elevation="none" glass style={{ border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.1)' }}>
                {portfolioMessage}
              </Card>
            ) : null}
            {portfolioError ? (
              <Card elevation="none" glass style={{ border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(127,29,29,0.25)' }}>
                {portfolioError}
              </Card>
            ) : null}
            {selectedPortfolioClient ? (
              <div style={{ display: 'grid', gap: '1rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#94A3B8', fontSize: '0.8rem' }}>
                      <th style={{ paddingBottom: '0.45rem' }}>Strategy</th>
                      <th style={{ paddingBottom: '0.45rem' }}>Weight %</th>
                      <th style={{ paddingBottom: '0.45rem' }}>Run mode</th>
                      <th style={{ paddingBottom: '0.45rem' }}>Max risk %</th>
                      <th style={{ paddingBottom: '0.45rem' }}>Enabled</th>
                      <th style={{ paddingBottom: '0.45rem' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioDraft.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '0.75rem 0', color: '#94A3B8', textAlign: 'center' }}>
                          No allocations configured yet.
                        </td>
                      </tr>
                    ) : (
                      portfolioDraft.map((row, index) => {
                        const used = new Set(
                          portfolioDraft
                            .filter((_, idx) => idx !== index)
                            .map((allocation) => allocation.strategyId)
                        );
                        return (
                          <tr key={`${row.strategyId}-${index}`} style={{ borderTop: '1px solid rgba(148,163,184,0.12)' }}>
                            <td style={{ padding: '0.6rem 0.4rem' }}>
                              <select
                                value={row.strategyId}
                                onChange={(event) => handleAllocationFieldChange(index, 'strategyId', event.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '0.45rem 0.6rem',
                                  borderRadius: 8,
                                  border: '1px solid rgba(148,163,184,0.2)',
                                  background: 'rgba(8,13,25,0.8)',
                                  color: '#E2E8F0',
                                }}
                              >
                                {strategyCatalog.map((strategy) => (
                                  <option
                                    key={strategy.id}
                                    value={strategy.id}
                                    disabled={used.has(strategy.id) && strategy.id !== row.strategyId}
                                  >
                                    {strategy.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: '0.6rem 0.4rem' }}>
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={row.weightPct}
                                onChange={(event) => handleAllocationFieldChange(index, 'weightPct', event.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '0.45rem 0.6rem',
                                  borderRadius: 8,
                                  border: '1px solid rgba(148,163,184,0.2)',
                                  background: 'rgba(8,13,25,0.8)',
                                  color: '#E2E8F0',
                                }}
                              />
                            </td>
                            <td style={{ padding: '0.6rem 0.4rem' }}>
                              <select
                                value={row.runMode}
                                onChange={(event) => handleAllocationFieldChange(index, 'runMode', event.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '0.45rem 0.6rem',
                                  borderRadius: 8,
                                  border: '1px solid rgba(148,163,184,0.2)',
                                  background: 'rgba(8,13,25,0.8)',
                                  color: '#E2E8F0',
                                }}
                              >
                                <option value="">Auto</option>
                                <option value="live">Live</option>
                                <option value="paper">Paper</option>
                                <option value="summary">Summary</option>
                              </select>
                            </td>
                            <td style={{ padding: '0.6rem 0.4rem' }}>
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={row.maxRiskPct}
                                onChange={(event) => handleAllocationFieldChange(index, 'maxRiskPct', event.target.value)}
                                placeholder="Optional"
                                style={{
                                  width: '100%',
                                  padding: '0.45rem 0.6rem',
                                  borderRadius: 8,
                                  border: '1px solid rgba(148,163,184,0.2)',
                                  background: 'rgba(8,13,25,0.8)',
                                  color: '#E2E8F0',
                                }}
                              />
                            </td>
                            <td style={{ padding: '0.6rem 0.4rem' }}>
                              <input
                                type="checkbox"
                                checked={row.enabled}
                                onChange={(event) => handleAllocationFieldChange(index, 'enabled', event.target.checked)}
                              />
                            </td>
                            <td style={{ padding: '0.6rem 0.4rem', textAlign: 'right' }}>
                              <Button variant="ghost" onClick={() => handleRemoveAllocation(index)}>
                                Remove
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                <div style={{ display: 'grid', gap: '0.35rem', color: '#94A3B8', fontSize: '0.85rem' }}>
                  <span>Total enabled weight: {totalDraftWeight.toFixed(1)}%</span>
                  <span>
                    Plan normalized: {portfolioPlan?.normalized ? 'Yes' : 'No'} · Active plan weight:{' '}
                    {planActiveWeight.toFixed(1)}%
                  </span>
                </div>
                <div style={{ borderTop: '1px solid rgba(148,163,184,0.15)', paddingTop: '0.85rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>Execution preview</h3>
                  {planEntries.length ? (
                    <div style={{ overflowX: 'auto', marginTop: '0.65rem' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 540 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', color: '#94A3B8', fontSize: '0.75rem' }}>
                            <th style={{ paddingBottom: '0.35rem' }}>Strategy</th>
                            <th style={{ paddingBottom: '0.35rem' }}>Final mode</th>
                            <th style={{ paddingBottom: '0.35rem' }}>Normalized %</th>
                            <th style={{ paddingBottom: '0.35rem' }}>Allocation USD</th>
                            <th style={{ paddingBottom: '0.35rem' }}>Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {planEntries.map((entry) => (
                            <tr key={entry.strategyId} style={{ borderTop: '1px solid rgba(148,163,184,0.12)' }}>
                              <td style={{ padding: '0.5rem 0.4rem' }}>{formatStrategyName(entry.strategyId)}</td>
                              <td style={{ padding: '0.5rem 0.4rem' }}>{entry.finalRunMode}</td>
                              <td style={{ padding: '0.5rem 0.4rem' }}>{entry.normalizedWeightPct.toFixed(1)}%</td>
                              <td style={{ padding: '0.5rem 0.4rem' }}>
                                {entry.allocationUsd ? `$${entry.allocationUsd.toFixed(2)}` : '—'}
                              </td>
                              <td style={{ padding: '0.5rem 0.4rem', color: entry.enabled ? '#34D399' : '#F87171' }}>
                                {entry.enabled ? entry.reason ?? 'Active' : entry.reason ?? 'Disabled'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p style={{ margin: '0.75rem 0', color: '#94A3B8' }}>No execution preview available.</p>
                  )}
                </div>
              </div>
            ) : (
              <p style={{ color: '#94A3B8', margin: 0 }}>Select a client to configure portfolio allocations.</p>
            )}
          </Card>

          <Card style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <Badge tone="primary">Client snapshot</Badge>
              <h2 style={{ margin: '0.75rem 0 0' }}>Strategy coverage</h2>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <input
                type="search"
                value={summaryTable.query}
                onChange={(event) => summaryTable.setQuery(event.target.value)}
                placeholder="Filter by client, plan, or billing status"
                style={{
                  flex: '1 1 260px',
                  minWidth: 240,
                  padding: '0.65rem 0.8rem',
                  borderRadius: 12,
                  border: '1px solid rgba(148,163,184,0.2)',
                  background: 'rgba(8,13,25,0.85)',
                  color: '#E2E8F0',
                }}
              />
              <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                <Button variant="ghost" onClick={() => {
                  const name = window.prompt('Save view as…');
                  if (name) {
                    summaryTable.saveView(name);
                    setSelectedSummaryView(name);
                  }
                }}>
                  Save view
                </Button>
                {summaryTable.views.length ? (
                  <>
                    <select
                      value={selectedSummaryView}
                      onChange={(event) => {
                        const value = event.target.value;
                        setSelectedSummaryView(value);
                        if (value) summaryTable.applyView(value);
                      }}
                      style={{
                        padding: '0.55rem 0.75rem',
                        borderRadius: 10,
                        border: '1px solid rgba(148,163,184,0.2)',
                        background: 'rgba(8,13,25,0.65)',
                        color: '#E2E8F0',
                      }}
                    >
                      <option value="">Saved views</option>
                      {summaryTable.views.map((view) => (
                        <option key={view.name} value={view.name}>
                          {view.name}
                        </option>
                      ))}
                    </select>
                    {selectedSummaryView ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          summaryTable.deleteView(selectedSummaryView);
                          setSelectedSummaryView('');
                        }}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </>
                ) : null}
                <Button variant="ghost" onClick={handleSummaryExport}>
                  Export CSV
                </Button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {summaryTable.query ? (
                <Badge tone="neutral" style={{ gap: '0.4rem' }}>
                  Query: {summaryTable.query}
                  <button
                    type="button"
                    onClick={() => summaryTable.setQuery('')}
                    style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem' }}
                    aria-label="Clear summary filter"
                  >
                    ×
                  </button>
                </Badge>
              ) : null}
              {summaryTable.sortState.map((rule, index) => (
                <Badge tone="primary" key={`${rule.columnKey}-${index}`} style={{ gap: '0.35rem' }}>
                  {index + 1}. {getColumnLabel(summaryColumns, rule.columnKey)} {rule.direction === 'asc' ? '↑' : '↓'}
                  <button
                    type="button"
                    onClick={() => summaryTable.setSort(summaryTable.sortState.filter((_, idx) => idx !== index))}
                    style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem' }}
                    aria-label="Clear sort"
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
            <DataTable
              columns={summaryColumns}
              data={summaryTable.rows}
              sortState={summaryTable.sortState}
              onSortChange={(state: SortState) => summaryTable.setSort(state)}
              emptyState={<span>No clients found.</span>}
              tableMinWidth={900}
            />
          </Card>

          <Card style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <Badge tone="primary">Billing posture</Badge>
              <h2 style={{ margin: '0.75rem 0 0' }}>Subscriptions</h2>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <input
                type="search"
                value={billingTable.query}
                onChange={(event) => billingTable.setQuery(event.target.value)}
                placeholder="Filter by client, plan, or status"
                style={{
                  flex: '1 1 260px',
                  minWidth: 240,
                  padding: '0.65rem 0.8rem',
                  borderRadius: 12,
                  border: '1px solid rgba(148,163,184,0.2)',
                  background: 'rgba(8,13,25,0.85)',
                  color: '#E2E8F0',
                }}
              />
              <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                <Button variant="ghost" onClick={() => {
                  const name = window.prompt('Save view as…');
                  if (name) {
                    billingTable.saveView(name);
                    setSelectedBillingView(name);
                  }
                }}>
                  Save view
                </Button>
                {billingTable.views.length ? (
                  <>
                    <select
                      value={selectedBillingView}
                      onChange={(event) => {
                        const value = event.target.value;
                        setSelectedBillingView(value);
                        if (value) billingTable.applyView(value);
                      }}
                      style={{
                        padding: '0.55rem 0.75rem',
                        borderRadius: 10,
                        border: '1px solid rgba(148,163,184,0.2)',
                        background: 'rgba(8,13,25,0.65)',
                        color: '#E2E8F0',
                      }}
                    >
                      <option value="">Saved views</option>
                      {billingTable.views.map((view) => (
                        <option key={view.name} value={view.name}>
                          {view.name}
                        </option>
                      ))}
                    </select>
                    {selectedBillingView ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          billingTable.deleteView(selectedBillingView);
                          setSelectedBillingView('');
                        }}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </>
                ) : null}
                <Button variant="ghost" onClick={handleBillingExport}>
                  Export CSV
                </Button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {billingTable.query ? (
                <Badge tone="neutral" style={{ gap: '0.4rem' }}>
                  Query: {billingTable.query}
                  <button
                    type="button"
                    onClick={() => billingTable.setQuery('')}
                    style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem' }}
                    aria-label="Clear billing filter"
                  >
                    ×
                  </button>
                </Badge>
              ) : null}
              {billingTable.sortState.map((rule, index) => (
                <Badge tone="primary" key={`${rule.columnKey}-${index}`} style={{ gap: '0.35rem' }}>
                  {index + 1}. {getColumnLabel(billingColumns, rule.columnKey)} {rule.direction === 'asc' ? '↑' : '↓'}
                  <button
                    type="button"
                    onClick={() => billingTable.setSort(billingTable.sortState.filter((_, idx) => idx !== index))}
                    style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem' }}
                    aria-label="Clear billing sort"
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
            <DataTable
              columns={billingColumns}
              data={billingTable.rows}
              sortState={billingTable.sortState}
              onSortChange={(state: SortState) => billingTable.setSort(state)}
              emptyState={<span>No billing records found.</span>}
              tableMinWidth={720}
            />
          </Card>
        </div>
      </DashboardLayout>
    </>
  );
}
