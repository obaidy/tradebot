import Head from 'next/head';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { MetricCard } from '../../components/ui/MetricCard';
import { DataTable, Column } from '../../components/ui/DataTable';
import { useTableControls } from '../../components/ui/useTableControls';
import { HeroVisualization } from '../../components/landing/HeroVisualization';

const REQUIRED_DOCUMENTS = [
  {
    key: 'tos',
    label: 'Terms of Service',
    version: process.env.NEXT_PUBLIC_TOS_VERSION || '2025-01-01',
    slug: 'terms',
  },
  {
    key: 'privacy',
    label: 'Privacy Policy',
    version: process.env.NEXT_PUBLIC_PRIVACY_VERSION || '2025-01-01',
    slug: 'privacy',
  },
  {
    key: 'risk',
    label: 'Risk Disclosure',
    version: process.env.NEXT_PUBLIC_RISK_VERSION || '2025-01-01',
    slug: 'risk',
  },
];

type Plan = {
  id: string;
  name: string;
  description: string;
  priceUsd: number;
  features: string[];
  limits: {
    maxSymbols: number;
    allowLiveTrading: boolean;
    paperOnly: boolean;
    allowedExchanges: string[];
    maxPerTradeUsd: number;
    maxExposureUsd: number;
    maxDailyVolumeUsd: number;
  };
};

type AuditEntry = {
  id: number;
  action: string;
  actor: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

type RunRow = {
  runId: string;
  status: string;
  startedAt: string | null;
  runMode: string;
  estNetProfit: number | null;
};

type InventoryRow = {
  snapshotTime: string | null;
  baseBalance: number;
  quoteBalance: number;
  exposureUsd: number | null;
};

function formatDate(input: string) {
  return new Date(input).toLocaleString();
}

function formatTrialCountdown(trialEndsAt: string | null) {
  if (!trialEndsAt) return null;
  const ending = new Date(trialEndsAt).getTime();
  const now = Date.now();
  const diffMs = ending - now;
  if (diffMs <= 0) return 'Expired';
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const diffHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ${diffHours}h remaining`;
  }
  const diffMinutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${diffHours}h ${diffMinutes}m remaining`;
}

function applyClientSnapshotState(
  snapshot: any,
  opts: {
    setClientState: (state: { isPaused: boolean; killRequested: boolean }) => void;
    setBillingInfo: (
      info: {
        status: string;
        trialEndsAt: string | null;
        planId: string;
        trialExpired: boolean;
        autoPaused: boolean;
      }
    ) => void;
  }
) {
  const clientSnapshot = snapshot?.client ?? {};
  const planId = (clientSnapshot.plan ?? clientSnapshot.planId) || 'starter';
  const trialEndsRaw = clientSnapshot.trialEndsAt ?? clientSnapshot.trial_ends_at ?? null;
  const trialEndsIso = trialEndsRaw ? new Date(trialEndsRaw).toISOString() : null;
  const billingStatus = clientSnapshot.billingStatus ?? clientSnapshot.billing_status ?? 'trialing';
  const trialExpired =
    billingStatus === 'trialing' && trialEndsIso ? new Date(trialEndsIso).getTime() <= Date.now() : false;
  const autoPaused = Boolean(clientSnapshot.billingAutoPaused ?? clientSnapshot.billing_auto_paused);
  opts.setBillingInfo({
    status: billingStatus,
    trialEndsAt: trialEndsIso,
    planId,
    trialExpired,
    autoPaused,
  });
  opts.setClientState({
    isPaused: Boolean(clientSnapshot.isPaused ?? clientSnapshot.is_paused),
    killRequested: Boolean(clientSnapshot.killRequested ?? clientSnapshot.kill_requested),
  });
}

async function fetchJson(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const detail = await res.json().catch((parseError) => {
      console.error('[portal] Failed to parse error response', parseError);
      return {};
    });
    throw new Error(detail.error || `Request failed (${res.status})`);
  }
  return res.json();
}

async function safeFetchJson<T>(url: string, fallback: T, options?: RequestInit): Promise<T> {
  try {
    return await fetchJson(url, options);
  } catch (error) {
    console.error('[portal] Request failed', url, error);
    return fallback;
  }
}

export default function Dashboard() {
  const { data: session, status } = useSession({ required: true });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [workers, setWorkers] = useState<any[]>([]);
  const [clientState, setClientState] = useState<{ isPaused: boolean; killRequested: boolean }>({
    isPaused: false,
    killRequested: false,
  });
  const [apiForm, setApiForm] = useState({ exchangeName: 'binance', apiKey: '', apiSecret: '', passphrase: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [billingInfo, setBillingInfo] = useState<{
    status: string;
    trialEndsAt: string | null;
    planId: string;
    trialExpired: boolean;
    autoPaused: boolean;
  }>({
    status: 'trialing',
    trialEndsAt: null,
    planId: 'starter',
    trialExpired: false,
    autoPaused: false,
  });
  const [processingCheckout, setProcessingCheckout] = useState(false);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [agreementRequirements, setAgreementRequirements] = useState<any[]>([]);
  const [ackChecklist, setAckChecklist] = useState<Record<string, boolean>>({});
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [guardSnapshot, setGuardSnapshot] = useState<any | null>(null);
  const [inventoryHistory, setInventoryHistory] = useState<any[]>([]);
  const [selectedAuditView, setSelectedAuditView] = useState('');
  const [selectedRunView, setSelectedRunView] = useState('');
  const [selectedInventoryView, setSelectedInventoryView] = useState('');

  const clientId = session?.user?.id;
  const actor = useMemo(() => session?.user?.email ?? clientId ?? 'unknown', [session?.user?.email, clientId]);

  const requiredDocumentsStatus = useMemo(() => {
    return REQUIRED_DOCUMENTS.map((doc) => {
      const requirement = agreementRequirements.find((req: any) => req.documentType === doc.key);
      return {
        ...doc,
        accepted: Boolean(requirement?.accepted),
        acceptedAt: requirement?.acceptedAt ?? null,
      };
    });
  }, [agreementRequirements]);

  const pendingDocuments = useMemo(
    () => requiredDocumentsStatus.filter((doc) => !doc.accepted),
    [requiredDocumentsStatus]
  );
  const needsAgreement = pendingDocuments.length > 0;

  useEffect(() => {
    if (!clientId || status === 'loading') return;
    let cancelled = false;

    async function bootstrap() {
      try {
        setLoading(true);
        setError(null);
        await fetchJson('/api/client/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: 'starter' }),
        });
        const [plansRes, snapshot, credsRes, auditRes, metricsRes, workersRes, historyRes, agreementsRes] = await Promise.all([
          fetchJson('/api/client/plans'),
          fetchJson('/api/client/snapshot'),
          fetchJson('/api/client/credentials'),
          fetchJson('/api/client/audit'),
          safeFetchJson('/api/client/metrics', null),
          safeFetchJson('/api/client/workers', []),
          safeFetchJson('/api/client/history', null),
          safeFetchJson('/api/client/agreements', null),
        ]);
        if (cancelled) return;
        setPlans(plansRes);
        applyClientSnapshotState(snapshot, {
          setClientState,
          setBillingInfo,
        });
        setCredentials(credsRes);
        setAuditEntries(auditRes);
        setMetrics(metricsRes);
        setWorkers(workersRes);
        setRunHistory(historyRes?.runs ?? []);
        setGuardSnapshot(historyRes?.guard ?? null);
        setInventoryHistory(historyRes?.inventory ?? []);
        setAgreements(agreementsRes?.agreements ?? []);
        setAgreementRequirements(agreementsRes?.requirements ?? []);
        setAckChecklist((prev) => {
          const next = { ...prev };
          const accepted = new Set(
            (agreementsRes?.requirements ?? [])
              .filter((req: any) => req.accepted)
              .map((req: any) => req.documentType)
          );
          REQUIRED_DOCUMENTS.forEach((doc) => {
            if (accepted.has(doc.key)) {
              next[doc.key] = true;
            }
          });
          return next;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load workspace');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [clientId, status]);

  useEffect(() => {
    if (!clientId || typeof window === 'undefined') return undefined;
    const source = new EventSource('/api/client/metrics/stream');
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setMetrics(data);
      } catch {
        // ignore malformed events
      }
    };
    source.onerror = () => {
      source.close();
    };
    return () => {
      source.close();
    };
  }, [clientId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get('checkout');
    const sessionId = params.get('session_id');
    if (checkoutStatus === 'success') {
      (async () => {
        try {
          if (sessionId) {
            await fetchJson('/api/client/billing/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId }),
            });
          }
          setMessage('Subscription updated successfully.');
          params.delete('checkout');
          params.delete('session_id');
          const newSearch = params.toString();
          const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`;
          window.history.replaceState({}, '', newUrl);
          await refreshSnapshot();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Billing sync failed');
        }
      })();
    } else if (checkoutStatus === 'cancelled') {
      setMessage('Checkout cancelled. No changes were made.');
      params.delete('checkout');
      params.delete('session_id');
      const newSearch = params.toString();
      const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  async function handlePlanCheckout(planId: string) {
    try {
      setProcessingCheckout(true);
      setMessage(null);
      setError(null);
      const checkout = await fetchJson('/api/client/billing/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      if (checkout?.url) {
        if (typeof window !== 'undefined') {
          window.location.href = checkout.url;
        }
        return;
      }
      setMessage('Checkout created. Follow the instructions in the opened window.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billing session failed');
    } finally {
      setProcessingCheckout(false);
    }
  }

  async function handleManageBilling() {
    try {
      setProcessingCheckout(true);
      setMessage(null);
      setError(null);
      const portal = await fetchJson('/api/client/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (portal?.url && typeof window !== 'undefined') {
        window.location.href = portal.url;
        return;
      }
      setMessage('Manage billing session created. Follow the instructions in the opened window.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billing portal failed');
    } finally {
      setProcessingCheckout(false);
    }
  }

  async function refreshSnapshot() {
    const snapshot = await fetchJson('/api/client/snapshot');
    applyClientSnapshotState(snapshot, {
      setClientState,
      setBillingInfo,
    });
    const history = await fetchJson('/api/client/history');
    setRunHistory(history?.runs ?? []);
    setGuardSnapshot(history?.guard ?? null);
    setInventoryHistory(history?.inventory ?? []);
    const agreementsRes = await fetchJson('/api/client/agreements');
    setAgreements(agreementsRes?.agreements ?? []);
    setAgreementRequirements(agreementsRes?.requirements ?? []);
    setAckChecklist((prev) => {
      const next = { ...prev };
      const accepted = new Set(
        (agreementsRes?.requirements ?? [])
          .filter((req: any) => req.accepted)
          .map((req: any) => req.documentType)
      );
      REQUIRED_DOCUMENTS.forEach((doc) => {
        if (accepted.has(doc.key)) {
          next[doc.key] = true;
        }
      });
      return next;
    });
  }

  async function refreshAudit() {
    const entries = await fetchJson('/api/client/audit');
    setAuditEntries(entries);
  }

  async function handleCredentialSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setMessage(null);
      setError(null);
      await fetchJson('/api/client/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiForm),
      });
      setMessage('Credentials stored securely');
      setApiForm({ ...apiForm, apiKey: '', apiSecret: '', passphrase: '' });
      const creds = await fetchJson('/api/client/credentials');
      setCredentials(creds);
      await refreshAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store credentials');
    }
  }

  async function handleTriggerPaper() {
    try {
      setMessage(null);
      setError(null);
      await fetchJson('/api/client/paper', { method: 'POST' });
      setMessage('Paper run requested. Check back shortly for updates.');
      await refreshAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to trigger paper run');
    }
  }

  async function refreshWorkers() {
    const workerList = await safeFetchJson('/api/client/workers', []);
    setWorkers(workerList);
    try {
      await refreshSnapshot();
    } catch {
      // ignore snapshot refresh failures; existing state remains
    }
  }

  async function handleAcceptDocuments() {
    try {
      setError(null);
      const documents = pendingDocuments.map((doc) => ({ documentType: doc.key, version: doc.version }));
      await fetchJson('/api/client/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents }),
      });
      setMessage('Thank you for accepting the latest terms.');
      setAckChecklist({});
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'agreement_accept_failed');
    }
  }

  async function handlePause() {
    try {
      setMessage(null);
      setError(null);
      await fetchJson('/api/client/pause', { method: 'POST' });
      setClientState((prev) => ({ ...prev, isPaused: true }));
      await refreshAudit();
      await refreshWorkers();
      setMessage('Client paused');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pause failed');
    }
  }

  async function handleResume() {
    try {
      setMessage(null);
      setError(null);
      await fetchJson('/api/client/resume', { method: 'POST' });
      setClientState((prev) => ({ ...prev, isPaused: false }));
      await refreshAudit();
      await refreshWorkers();
      setMessage('Client resumed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed');
    }
  }

  async function handleKill() {
    try {
      setMessage(null);
      setError(null);
      await fetchJson('/api/client/kill', { method: 'POST' });
      setClientState({ isPaused: true, killRequested: true });
      await refreshAudit();
      await refreshWorkers();
      setMessage('Kill request sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kill request failed');
    }
  }

  const currentPlan = useMemo(
    () => plans.find((plan) => plan.id === billingInfo.planId) ?? plans[0] ?? null,
    [plans, billingInfo.planId]
  );

  const trialCountdown = useMemo(() => formatTrialCountdown(billingInfo.trialEndsAt), [billingInfo.trialEndsAt]);

  const metricsPnlTrend = metrics?.pnl?.history && Array.isArray(metrics.pnl.history) ? metrics.pnl.history : null;

  const pnlTrend = useMemo(() => {
    if (metricsPnlTrend && metricsPnlTrend.length > 0) return metricsPnlTrend as number[];
    if (runHistory.length === 0) return null;
    return runHistory
      .slice(-16)
      .map((run) => (typeof run.estNetProfit === 'number' ? run.estNetProfit : 0));
  }, [metricsPnlTrend, runHistory]);

  const auditColumns = useMemo<Column<AuditEntry>[]>(
    () => [
      {
        key: 'action',
        header: 'Action',
        render: (row) => row.action,
        sortable: true,
      },
      {
        key: 'actor',
        header: 'Actor',
        render: (row) => row.actor,
        sortable: true,
      },
      {
        key: 'createdAt',
        header: 'When',
        render: (row) => formatDate(row.createdAt),
        sortable: true,
        sortAccessor: (row) => new Date(row.createdAt),
      },
    ],
    []
  );

  const runHistoryColumns = useMemo<Column<RunRow>[]>(
    () => [
      {
        key: 'runId',
        header: 'Run ID',
        render: (row) => row.runId,
        sortable: true,
      },
      {
        key: 'startedAt',
        header: 'Started',
        render: (row) => (row.startedAt ? new Date(row.startedAt).toLocaleString() : '—'),
        sortable: true,
        sortAccessor: (row) => (row.startedAt ? new Date(row.startedAt) : null),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => row.status,
        sortable: true,
      },
      {
        key: 'runMode',
        header: 'Mode',
        render: (row) => row.runMode,
        sortable: true,
      },
      {
        key: 'estNetProfit',
        header: 'Est. Net PnL',
        align: 'right' as const,
        render: (row) =>
          row.estNetProfit !== null && row.estNetProfit !== undefined ? row.estNetProfit.toFixed(4) : '—',
        sortable: true,
        sortAccessor: (row) => row.estNetProfit ?? 0,
      },
    ],
    []
  );

  const inventoryColumns = useMemo<Column<InventoryRow>[]>(
    () => [
      {
        key: 'snapshotTime',
        header: 'Timestamp',
        render: (row) => (row.snapshotTime ? new Date(row.snapshotTime).toLocaleString() : '—'),
        sortable: true,
        sortAccessor: (row) => (row.snapshotTime ? new Date(row.snapshotTime) : null),
      },
      {
        key: 'baseBalance',
        header: 'Base',
        align: 'right' as const,
        render: (row) => Number(row.baseBalance).toFixed(6),
        sortable: true,
      },
      {
        key: 'quoteBalance',
        header: 'Quote',
        align: 'right' as const,
        render: (row) => Number(row.quoteBalance).toFixed(2),
        sortable: true,
      },
      {
        key: 'exposureUsd',
        header: 'Exposure USD',
        align: 'right' as const,
        render: (row) =>
          row.exposureUsd !== null && row.exposureUsd !== undefined ? row.exposureUsd.toFixed(2) : '—',
        sortable: true,
        sortAccessor: (row) => row.exposureUsd ?? 0,
      },
    ],
    []
  );

  const auditTable = useTableControls(auditEntries, {
    columns: auditColumns,
    initialSort: [{ columnKey: 'createdAt', direction: 'desc' }],
    filterFn: (row, query) =>
      row.action.toLowerCase().includes(query) || row.actor.toLowerCase().includes(query) || row.createdAt.toLowerCase().includes(query),
    storageKey: 'tradebot.audit.views',
  });

  const runTable = useTableControls<RunRow>(runHistory, {
    columns: runHistoryColumns,
    initialSort: [{ columnKey: 'startedAt', direction: 'desc' }],
    filterFn: (row, query) =>
      row.runId.toLowerCase().includes(query) ||
      (row.runMode ?? '').toLowerCase().includes(query) ||
      (row.status ?? '').toLowerCase().includes(query),
    storageKey: 'tradebot.runs.views',
  });

  const inventoryTable = useTableControls<InventoryRow>(inventoryHistory, {
    columns: inventoryColumns,
    initialSort: [{ columnKey: 'snapshotTime', direction: 'desc' }],
    filterFn: (row, query) => {
      const safe = query.toLowerCase();
      return (
        (row.snapshotTime ?? '').toLowerCase().includes(safe) ||
        row.baseBalance.toString().includes(query) ||
        row.quoteBalance.toString().includes(query)
      );
    },
    storageKey: 'tradebot.inventory.views',
  });

  const getColumnLabel = (columns: Column<any>[], key: string) => {
    const column = columns.find((col) => col.key === key);
    if (!column) return key;
    const header = column.header;
    return typeof header === 'string' || typeof header === 'number' ? String(header) : column.key;
  };

  const requestCsvExport = async (dataset: string, headers: string[], rows: Array<Array<string | number | null>>) => {
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
      setMessage(`Export queued to ${payload.location}`);
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
  };

  const handleAuditExport = async () => {
    try {
      await requestCsvExport('audit-trail', ['Action', 'Actor', 'When'], auditTable.rows.map((row) => [row.action, row.actor, formatDate(row.createdAt)]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export_failed');
    }
  };

  const handleRunExport = async () => {
    try {
      await requestCsvExport('runs', ['Run ID', 'Started', 'Status', 'Mode', 'Est. Net PnL'], runTable.rows.map((row) => [
        row.runId,
        row.startedAt ? new Date(row.startedAt).toLocaleString() : '',
        row.status,
        row.runMode,
        row.estNetProfit !== null && row.estNetProfit !== undefined ? row.estNetProfit.toFixed(4) : '',
      ]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export_failed');
    }
  };

  const handleInventoryExport = async () => {
    try {
      await requestCsvExport('inventory-history', ['Timestamp', 'Base', 'Quote', 'Exposure USD'], inventoryTable.rows.map((row) => [
        row.snapshotTime ? new Date(row.snapshotTime).toLocaleString() : '',
        row.baseBalance.toFixed(6),
        row.quoteBalance.toFixed(2),
        row.exposureUsd !== null && row.exposureUsd !== undefined ? row.exposureUsd.toFixed(2) : '',
      ]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export_failed');
    }
  };

  const handleAuditSaveView = () => {
    const name = window.prompt('Name this audit view');
    if (name) {
      auditTable.saveView(name);
      setSelectedAuditView(name);
    }
  };

  const handleRunSaveView = () => {
    const name = window.prompt('Name this run view');
    if (name) {
      runTable.saveView(name);
      setSelectedRunView(name);
    }
  };

  const handleInventorySaveView = () => {
    const name = window.prompt('Name this inventory view');
    if (name) {
      inventoryTable.saveView(name);
      setSelectedInventoryView(name);
    }
  };

  type SummaryCardConfig = {
    label: string;
    value: string;
    footer?: string;
    accent: 'primary' | 'secondary' | 'success' | 'warning';
    trend?: number[] | null;
    animated?: boolean;
  };

  const summaryCards = useMemo<SummaryCardConfig[]>(
    () => [
      {
        label: 'Plan',
        value: currentPlan?.name ?? 'Starter',
        footer: `Billing status: ${billingInfo.status}`,
        accent: 'primary',
      },
      {
        label: 'Trial window',
        value: billingInfo.trialExpired ? 'Expired' : trialCountdown ?? 'Active',
        footer: billingInfo.trialExpired ? 'Paper-only until upgraded' : currentPlan?.description ?? 'Active trial',
        accent: billingInfo.trialExpired ? 'warning' : 'secondary',
      },
      {
        label: 'Runner state',
        value: clientState.killRequested ? 'Kill requested' : clientState.isPaused ? 'Paused' : 'Active',
        footer:
          billingInfo.autoPaused
            ? 'Auto-paused by billing guard'
            : workers.length
            ? `${workers.length} worker${workers.length === 1 ? '' : 's'} connected`
            : 'No workers registered yet',
        accent: clientState.killRequested ? 'warning' : clientState.isPaused ? 'secondary' : 'success',
      },
      {
        label: 'Global P&L',
        value:
          metrics?.pnl?.global !== undefined && metrics?.pnl?.global !== null
            ? `$${metrics.pnl.global.toFixed(2)}`
            : 'Awaiting runs',
        footer:
          metrics?.lastTickerTs
            ? `Last ticker ${new Date(metrics.lastTickerTs).toLocaleTimeString()}`
            : 'Run walk-forward to populate telemetry',
        accent: 'primary',
        trend: pnlTrend ?? null,
        animated: true,
      },
    ],
    [currentPlan, billingInfo, trialCountdown, clientState, workers, metrics, pnlTrend]
  );

  const topRightSlot = useMemo(
    () => (
      <>
        <div style={{ textAlign: 'right' }}>
          <p
            style={{
              margin: 0,
              fontSize: '0.75rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#94A3B8',
            }}
          >
            Signed in as
          </p>
          <p style={{ margin: 0, fontWeight: 600 }}>{session?.user?.email ?? actor}</p>
        </div>
        <Button variant="ghost" onClick={() => signOut({ callbackUrl: '/' })}>
          Sign out
        </Button>
      </>
    ),
    [session?.user?.email, actor]
  );

  if (status === 'loading' || loading) {
    return (
      <DashboardLayout topRightSlot={topRightSlot}>
        <Card style={{ textAlign: 'center' }}>Loading your workspace…</Card>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout topRightSlot={topRightSlot}>
        <Card style={{ textAlign: 'center', display: 'grid', gap: '1rem' }}>
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          <p style={{ margin: 0 }}>{error}</p>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <>
      <Head>
        <title>TradeBot Portal · Operator Console</title>
      </Head>
      <DashboardLayout topRightSlot={topRightSlot}>
        <div style={{ display: 'grid', gap: '1.75rem' }}>
          {message ? (
            <Card elevation="none" glass style={{ border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.12)' }}>
              <p style={{ margin: 0, color: '#BBF7D0' }}>{message}</p>
            </Card>
          ) : null}

          <div className="metrics-grid">
            {pnlTrend && pnlTrend.length > 2 ? (
              <Card
                style={{
                  gridColumn: '1 / -1',
                  padding: '2.25rem',
                  display: 'grid',
                  gap: '1.5rem',
                  background: 'linear-gradient(135deg, rgba(14,165,233,0.25), rgba(59,130,246,0.15))',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                hoverLift
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div>
                    <Badge tone="primary">Live telemetry</Badge>
                    <h2 style={{ margin: '0.85rem 0 0' }}>Strategy momentum</h2>
                    <p style={{ margin: 0, color: '#CFE5FF', maxWidth: 520 }}>
                      Real-time global P&L trajectory blended with recent paper runs. Use it as your north star before
                      promoting to live.
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 180 }}>
                    <p style={{ margin: 0, color: '#bbf7d0', fontSize: '0.85rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Latest global P&L
                    </p>
                    <p style={{ margin: '0.35rem 0 0', fontSize: '1.65rem', fontWeight: 700 }}>
                      {metrics?.pnl?.global !== undefined && metrics?.pnl?.global !== null
                        ? `$${metrics.pnl.global.toFixed(2)}`
                        : '—'}
                    </p>
                  </div>
                </div>
                <div className="dashboard-hero">
                  <HeroVisualization points={pnlTrend} />
                </div>
              </Card>
            ) : null}
            {summaryCards.map((metric) => (
              <MetricCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                footer={metric.footer}
                accent={metric.accent}
                trend={metric.trend ?? undefined}
                animated={metric.animated}
              />
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gap: '1.5rem',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            }}
          >
            <Card style={{ display: 'grid', gap: '1.2rem' }}>
              <div>
                <Badge tone="primary">Plan & Billing</Badge>
                <h2 style={{ margin: '0.75rem 0 0' }}>Choose your path</h2>
                <p style={{ color: '#94A3B8', margin: 0 }}>Upgrade unlocks live promotion gates and extended telemetry.</p>
              </div>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {plans.map((plan) => {
                  const isCurrent = billingInfo.planId === plan.id;
                  const planIndex = plans.findIndex((p) => p.id === plan.id);
                  const currentIndex = currentPlan ? plans.findIndex((p) => p.id === currentPlan.id) : planIndex;
                  const isDowngrade = !isCurrent && planIndex < currentIndex;
                  return (
                    <Card
                      key={plan.id}
                      glass={false}
                      elevation="none"
                      style={{
                        border: isCurrent ? '1px solid rgba(56,189,248,0.45)' : '1px solid rgba(148,163,184,0.12)',
                        background: isCurrent ? 'rgba(14,165,233,0.12)' : 'rgba(15,23,42,0.55)',
                        padding: '1.1rem 1.2rem',
                        display: 'grid',
                        gap: '0.6rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>{plan.name}</strong>
                          {isCurrent ? <Badge tone="primary" style={{ marginLeft: '0.65rem' }}>Current</Badge> : null}
                        </div>
                        <span>${plan.priceUsd}/mo</span>
                      </div>
                      <p style={{ margin: 0, color: '#94A3B8' }}>{plan.description}</p>
                      <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#E2E8F0', display: 'grid', gap: '0.35rem' }}>
                        {plan.features.map((feature) => (
                          <li key={feature}>{feature}</li>
                        ))}
                      </ul>
                      <Button
                        variant={isCurrent ? 'secondary' : 'primary'}
                        onClick={() => (isCurrent ? handleManageBilling() : handlePlanCheckout(plan.id))}
                        disabled={processingCheckout}
                      >
                        {isCurrent ? 'Manage billing' : isDowngrade ? 'Downgrade' : 'Upgrade'}
                      </Button>
                    </Card>
                  );
                })}
              </div>
            </Card>

            <Card style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <Badge tone="primary">API credentials</Badge>
                <h2 style={{ margin: '0.75rem 0 0' }}>Secure exchange keys</h2>
                <p style={{ color: '#94A3B8', margin: 0 }}>Trade-only permissions recommended. Keys encrypted at rest.</p>
              </div>
              <form onSubmit={handleCredentialSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
                <label style={{ display: 'grid', gap: '0.35rem', fontSize: '0.9rem' }}>
                  Exchange
                  <select
                    value={apiForm.exchangeName}
                    onChange={(event) => setApiForm((prev) => ({ ...prev, exchangeName: event.target.value }))}
                    style={{
                      padding: '0.65rem',
                      borderRadius: 12,
                      border: '1px solid rgba(148,163,184,0.25)',
                      background: 'rgba(8,13,25,0.85)',
                      color: '#E2E8F0',
                    }}
                  >
                    <option value="binance">Binance</option>
                    <option value="coinbase">Coinbase Advanced</option>
                    <option value="bybit">Bybit</option>
                    <option value="okx">OKX</option>
                  </select>
                </label>
                <label style={{ display: 'grid', gap: '0.35rem', fontSize: '0.9rem' }}>
                  API key
                  <input
                    value={apiForm.apiKey}
                    onChange={(event) => setApiForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                    required
                    style={{
                      padding: '0.65rem',
                      borderRadius: 12,
                      border: '1px solid rgba(148,163,184,0.25)',
                      background: 'rgba(8,13,25,0.85)',
                      color: '#E2E8F0',
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gap: '0.35rem', fontSize: '0.9rem' }}>
                  API secret
                  <input
                    value={apiForm.apiSecret}
                    onChange={(event) => setApiForm((prev) => ({ ...prev, apiSecret: event.target.value }))}
                    required
                    type="password"
                    style={{
                      padding: '0.65rem',
                      borderRadius: 12,
                      border: '1px solid rgba(148,163,184,0.25)',
                      background: 'rgba(8,13,25,0.85)',
                      color: '#E2E8F0',
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gap: '0.35rem', fontSize: '0.9rem' }}>
                  Passphrase (optional)
                  <input
                    value={apiForm.passphrase}
                    onChange={(event) => setApiForm((prev) => ({ ...prev, passphrase: event.target.value }))}
                    style={{
                      padding: '0.65rem',
                      borderRadius: 12,
                      border: '1px solid rgba(148,163,184,0.25)',
                      background: 'rgba(8,13,25,0.85)',
                      color: '#E2E8F0',
                    }}
                  />
                </label>
                <Button type="submit">Save credentials</Button>
              </form>
              <div>
                <h3 style={{ margin: '1rem 0 0.5rem' }}>Stored credentials</h3>
                {credentials.length === 0 ? (
                  <p style={{ color: '#94A3B8' }}>No credentials stored yet.</p>
                ) : (
                  <ul style={{ lineHeight: 1.65, margin: 0, paddingLeft: '1.2rem', color: '#E2E8F0' }}>
                    {credentials.map((cred) => (
                      <li key={cred.exchangeName}>{cred.exchangeName} — stored {formatDate(cred.createdAt)}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            <Card style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <Badge tone="primary">Paper validation</Badge>
                <h2 style={{ margin: '0.75rem 0 0' }}>Canary on demand</h2>
                <p style={{ color: '#94A3B8', margin: 0 }}>
                  Trigger a paper run with the current configuration. Operators review telemetry before enabling live trading.
                </p>
              </div>
              <Button variant="secondary" onClick={handleTriggerPaper}>
                Request paper run
              </Button>
              <div>
                <h3 style={{ margin: '1rem 0 0.35rem' }}>Metrics snapshot</h3>
                {metrics ? (
                  <ul style={{ lineHeight: 1.65, margin: 0, color: '#E2E8F0' }}>
                    <li>Global P&L: ${metrics.pnl.global.toFixed(2)}</li>
                    <li>Run P&L: ${metrics.pnl.run.toFixed(2)}</li>
                    <li>Inventory base: {metrics.inventory.base.toFixed(4)}</li>
                    <li>
                      Last ticker: {metrics.lastTickerTs ? new Date(metrics.lastTickerTs).toLocaleString() : 'n/a'}
                    </li>
                  </ul>
                ) : (
                  <p style={{ color: '#94A3B8' }}>No telemetry yet. Launch a paper run to generate data.</p>
                )}
              </div>
            </Card>
          </div>

          <div
            style={{
              display: 'grid',
              gap: '1.5rem',
              gridTemplateColumns: 'minmax(320px, 1fr) minmax(360px, 1fr)',
            }}
          >
            <Card style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <Badge tone="primary">Runner controls</Badge>
                <h2 style={{ margin: '0.75rem 0 0' }}>Guard rails</h2>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <Button variant="secondary" onClick={handlePause} disabled={clientState.isPaused}>
                  Pause
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleResume}
                  disabled={!clientState.isPaused || clientState.killRequested || billingInfo.autoPaused}
                >
                  Resume
                </Button>
                <Button variant="ghost" onClick={handleKill} disabled={clientState.killRequested}>
                  Kill
                </Button>
              </div>
              <p style={{ margin: 0, color: '#94A3B8' }}>
                Runner paused: {clientState.isPaused ? 'Yes' : 'No'} · Kill requested: {clientState.killRequested ? 'Yes' : 'No'}
              </p>
              <div>
                <h3 style={{ margin: '1rem 0 0.35rem' }}>Workers</h3>
                {workers.length === 0 ? (
                  <p style={{ color: '#94A3B8' }}>No workers registered.</p>
                ) : (
                  <ul style={{ lineHeight: 1.6, margin: 0, paddingLeft: '1.2rem', color: '#E2E8F0' }}>
                    {workers.map((worker) => {
                      const id = (worker.workerId ?? worker.worker_id) as string;
                      const status = worker.status ?? worker.status;
                      const lastHeartbeatRaw = worker.lastHeartbeat ?? worker.last_heartbeat;
                      const metadata = (worker.metadata ?? worker.metadata) as Record<string, any> | null;
                      const queueDepth = typeof metadata?.queueDepth === 'number' ? metadata.queueDepth : undefined;
                      const lastError = metadata?.lastError as
                        | { message?: string; failedAt?: string; jobId?: string; stack?: string }
                        | undefined;
                      return (
                        <li key={id} style={{ marginBottom: '0.5rem' }}>
                          {id} — {status}
                          {lastHeartbeatRaw ? ` (heartbeat ${formatDate(lastHeartbeatRaw)})` : ''}
                          {queueDepth !== undefined ? ` · Queue depth ${queueDepth}` : ''}
                          {lastError?.message ? (
                            <div style={{ color: '#F87171', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                              Last error: {lastError.message}
                              {lastError.jobId ? ` (job ${lastError.jobId})` : ''}
                              {lastError.failedAt ? ` at ${formatDate(lastError.failedAt)}` : ''}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>

            <Card style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <Badge tone="primary">Audit trail</Badge>
                <h2 style={{ margin: '0.75rem 0 0' }}>Recent actions</h2>
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
                  value={auditTable.query}
                  onChange={(event) => auditTable.setQuery(event.target.value)}
                  placeholder="Filter actions or actor"
                  style={{
                    flex: '1 1 220px',
                    minWidth: 200,
                    padding: '0.65rem 0.8rem',
                    borderRadius: 12,
                    border: '1px solid rgba(148,163,184,0.2)',
                    background: 'rgba(8,13,25,0.85)',
                    color: '#E2E8F0',
                  }}
                />
                <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Button variant="ghost" onClick={handleAuditSaveView}>
                    Save view
                  </Button>
                  {auditTable.views.length ? (
                    <>
                      <select
                        value={selectedAuditView}
                        onChange={(event) => {
                          const value = event.target.value;
                          setSelectedAuditView(value);
                          if (value) auditTable.applyView(value);
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
                        {auditTable.views.map((view) => (
                          <option key={view.name} value={view.name}>
                            {view.name}
                          </option>
                        ))}
                      </select>
                      {selectedAuditView ? (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            auditTable.deleteView(selectedAuditView);
                            setSelectedAuditView('');
                          }}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  <Button variant="ghost" onClick={handleAuditExport}>
                    Export CSV
                  </Button>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {auditTable.query ? (
                  <Badge tone="neutral" style={{ gap: '0.4rem' }}>
                    Query: {auditTable.query}
                    <button
                      type="button"
                      onClick={() => auditTable.setQuery('')}
                      style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem' }}
                      aria-label="Clear audit filter"
                    >
                      ×
                    </button>
                  </Badge>
                ) : null}
                {auditTable.sortState.length
                  ? auditTable.sortState.map((rule, index) => (
                      <Badge tone="primary" key={`${rule.columnKey}-${index}`} style={{ gap: '0.35rem' }}>
                        {index + 1}. {getColumnLabel(auditColumns, rule.columnKey)} {rule.direction === 'asc' ? '↑' : '↓'}
                        <button
                          type="button"
                          onClick={() => auditTable.setSort(auditTable.sortState.filter((_, idx) => idx !== index))}
                          style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem' }}
                          aria-label="Remove sort"
                        >
                          ×
                        </button>
                      </Badge>
                    ))
                  : null}
              </div>
              <DataTable
                columns={auditColumns}
                data={auditTable.rows}
                sortState={auditTable.sortState}
                onSortChange={auditTable.setSort}
                emptyState={<span>No actions logged yet.</span>}
                tableMinWidth={360}
              />
            </Card>
          </div>

          <Card style={{ display: 'grid', gap: '1.5rem' }}>
            <div>
              <Badge tone="primary">Performance history</Badge>
              <h2 style={{ margin: '0.75rem 0 0' }}>Run archive</h2>
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
                value={runTable.query}
                onChange={(event) => runTable.setQuery(event.target.value)}
                placeholder="Search runs by ID, status, or mode"
                style={{
                  flex: '1 1 240px',
                  minWidth: 220,
                  padding: '0.65rem 0.8rem',
                  borderRadius: 12,
                  border: '1px solid rgba(148,163,184,0.2)',
                  background: 'rgba(8,13,25,0.85)',
                  color: '#E2E8F0',
                }}
              />
              <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                <Button variant="ghost" onClick={handleRunSaveView}>
                  Save view
                </Button>
                {runTable.views.length ? (
                  <>
                    <select
                      value={selectedRunView}
                      onChange={(event) => {
                        const value = event.target.value;
                        setSelectedRunView(value);
                        if (value) runTable.applyView(value);
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
                      {runTable.views.map((view) => (
                        <option key={view.name} value={view.name}>
                          {view.name}
                        </option>
                      ))}
                    </select>
                    {selectedRunView ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          runTable.deleteView(selectedRunView);
                          setSelectedRunView('');
                        }}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </>
                ) : null}
                <Button variant="ghost" onClick={handleRunExport}>
                  Export CSV
                </Button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {runTable.query ? (
                <Badge tone="neutral" style={{ gap: '0.4rem' }}>
                  Query: {runTable.query}
                  <button
                    type="button"
                    onClick={() => runTable.setQuery('')}
                    style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem' }}
                    aria-label="Clear run filter"
                  >
                    ×
                  </button>
                </Badge>
              ) : null}
              {runTable.sortState.length
                ? runTable.sortState.map((rule, index) => (
                    <Badge tone="primary" key={`${rule.columnKey}-${index}`} style={{ gap: '0.35rem' }}>
                      {index + 1}. {getColumnLabel(runHistoryColumns, rule.columnKey)} {rule.direction === 'asc' ? '↑' : '↓'}
                      <button
                        type="button"
                        onClick={() => runTable.setSort(runTable.sortState.filter((_, idx) => idx !== index))}
                        style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem' }}
                        aria-label="Clear run sort"
                      >
                        ×
                      </button>
                    </Badge>
                  ))
                : null}
            </div>
            <DataTable
              columns={runHistoryColumns}
              data={runTable.rows.slice(0, 10)}
              sortState={runTable.sortState}
              onSortChange={runTable.setSort}
              emptyState={<span>No runs recorded yet.</span>}
              tableMinWidth={720}
            />

            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              <Card elevation="none" glass style={{ padding: '1.25rem', background: 'rgba(32, 54, 84, 0.35)' }}>
                <h3 style={{ margin: '0 0 0.5rem' }}>Guard snapshot</h3>
                {guardSnapshot ? (
                  <ul style={{ margin: 0, paddingLeft: '1.1rem', color: '#E2E8F0', lineHeight: 1.6 }}>
                    <li>Global PnL: {guardSnapshot.globalPnl.toFixed(2)}</li>
                    <li>Run PnL: {guardSnapshot.runPnl.toFixed(2)}</li>
                    <li>Inventory base: {guardSnapshot.inventoryBase.toFixed(4)}</li>
                    <li>Inventory cost: {guardSnapshot.inventoryCost.toFixed(2)}</li>
                    <li>
                      Last ticker: {guardSnapshot.lastTickerTs ? new Date(guardSnapshot.lastTickerTs).toLocaleString() : '—'}
                    </li>
                    <li>API errors (60s): {guardSnapshot.apiErrorsLastMinute}</li>
                  </ul>
                ) : (
                  <p style={{ color: '#94A3B8' }}>No guard data yet.</p>
                )}
              </Card>
              <Card elevation="none" glass style={{ padding: '1.25rem', background: 'rgba(32, 54, 84, 0.35)' }}>
                <h3 style={{ margin: '0 0 0.5rem' }}>Inventory history</h3>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.6rem',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.75rem',
                  }}
                >
                  <input
                    type="search"
                    value={inventoryTable.query}
                    onChange={(event) => inventoryTable.setQuery(event.target.value)}
                    placeholder="Filter inventory snapshots"
                    style={{
                      flex: '1 1 200px',
                      minWidth: 180,
                      padding: '0.55rem 0.75rem',
                      borderRadius: 10,
                      border: '1px solid rgba(148,163,184,0.2)',
                      background: 'rgba(8,13,25,0.65)',
                      color: '#E2E8F0',
                    }}
                  />
                  <div style={{ display: 'inline-flex', gap: '0.45rem', alignItems: 'center' }}>
                    <Button variant="ghost" onClick={handleInventorySaveView}>
                      Save view
                    </Button>
                    {inventoryTable.views.length ? (
                      <>
                        <select
                          value={selectedInventoryView}
                          onChange={(event) => {
                            const value = event.target.value;
                            setSelectedInventoryView(value);
                            if (value) inventoryTable.applyView(value);
                          }}
                          style={{
                            padding: '0.5rem 0.7rem',
                            borderRadius: 10,
                            border: '1px solid rgba(148,163,184,0.2)',
                            background: 'rgba(8,13,25,0.65)',
                            color: '#E2E8F0',
                          }}
                        >
                          <option value="">Saved views</option>
                          {inventoryTable.views.map((view) => (
                            <option key={view.name} value={view.name}>
                              {view.name}
                            </option>
                          ))}
                        </select>
                        {selectedInventoryView ? (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              inventoryTable.deleteView(selectedInventoryView);
                              setSelectedInventoryView('');
                            }}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                    <Button variant="ghost" onClick={handleInventoryExport}>
                      Export CSV
                    </Button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  {inventoryTable.query ? (
                    <Badge tone="neutral" style={{ gap: '0.4rem' }}>
                      Query: {inventoryTable.query}
                      <button
                        type="button"
                        onClick={() => inventoryTable.setQuery('')}
                        style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem' }}
                        aria-label="Clear inventory filter"
                      >
                        ×
                      </button>
                    </Badge>
                  ) : null}
                  {inventoryTable.sortState.length
                    ? inventoryTable.sortState.map((rule, index) => (
                        <Badge tone="primary" key={`${rule.columnKey}-${index}`} style={{ gap: '0.35rem' }}>
                          {index + 1}. {getColumnLabel(inventoryColumns, rule.columnKey)}{' '}
                          {rule.direction === 'asc' ? '↑' : '↓'}
                          <button
                            type="button"
                            onClick={() => inventoryTable.setSort(inventoryTable.sortState.filter((_, idx) => idx !== index))}
                            style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem' }}
                            aria-label="Clear inventory sort"
                          >
                            ×
                          </button>
                        </Badge>
                      ))
                    : null}
                </div>
                <DataTable
                  columns={inventoryColumns}
                  data={inventoryTable.rows.slice(0, 10)}
                  sortState={inventoryTable.sortState}
                  onSortChange={inventoryTable.setSort}
                  emptyState={<span>No inventory snapshots yet.</span>}
                  tableMinWidth={480}
                  style={{ maxHeight: 220, overflowY: 'auto' }}
                />
              </Card>
            </div>
          </Card>
        </div>
      </DashboardLayout>

      {needsAgreement ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 8, 22, 0.94)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            zIndex: 9999,
          }}
        >
          <Card style={{ maxWidth: 520, width: '100%', display: 'grid', gap: '1rem' }}>
            <h2 style={{ margin: 0 }}>Accept updated terms</h2>
            <p style={{ color: '#94A3B8', margin: 0 }}>
              Please review and accept the latest customer agreements before continuing. Links open in a new tab.
            </p>
            <div style={{ display: 'grid', gap: '0.75rem', margin: '0.5rem 0 0' }}>
              {pendingDocuments.map((doc) => (
                <label key={doc.key} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', fontSize: '0.95rem' }}>
                  <input
                    type="checkbox"
                    checked={ackChecklist[doc.key] || false}
                    onChange={(event) => setAckChecklist((prev) => ({ ...prev, [doc.key]: event.target.checked }))}
                    style={{ marginTop: '0.3rem' }}
                  />
                  <span>
                    I have read and agree to the{' '}
                    <a href={`/legal/${doc.slug}`} target="_blank" rel="noopener noreferrer">
                      {doc.label} (v{doc.version})
                    </a>
                  </span>
                </label>
              ))}
            </div>
            <Button
              variant="primary"
              fullWidth
              disabled={!pendingDocuments.every((doc) => ackChecklist[doc.key])}
              onClick={handleAcceptDocuments}
            >
              Accept and continue
            </Button>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#94A3B8' }}>
              By proceeding you acknowledge that trading involves risk and no performance is guaranteed.
            </p>
          </Card>
        </div>
      ) : null}
    </>
  );
}
