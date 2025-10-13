import Head from 'next/head';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';

interface TradeApproval {
  id: number;
  correlationId: string | null;
  clientId: string;
  strategyId: string | null;
  tradeType: string;
  thresholdReason: string | null;
  amountUsd: number | null;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedAt: string;
  approvedBy: string[] | null;
  approvedAt: string | null;
  metadata: Record<string, unknown> | null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail: any = null;
    try {
      detail = await res.json();
    } catch {
      // ignore
    }
    throw new Error(detail?.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) {
    return null as unknown as T;
  }
  return res.json();
}

function formatAmount(value: number | null) {
  if (value === null || value === undefined) return '—';
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export default function ApprovalsPage() {
  const { data: session } = useSession();
  const [approvals, setApprovals] = useState<TradeApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');

  const loadApprovals = useCallback(async () => {
    try {
      setLoading(true);
      const records = await fetchJson<TradeApproval[]>(`/api/admin/approvals?status=${statusFilter}`);
      setApprovals(records);
      setError(null);
    } catch (err) {
      setApprovals([]);
      setError(err instanceof Error ? err.message : 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const pendingCount = useMemo(
    () => approvals.filter((record) => record.status === 'pending').length,
    [approvals]
  );

  async function handleApprove(id: number) {
    try {
      setMessage(null);
      setError(null);
      await fetchJson(`/api/admin/approvals/${id}/approve`, { method: 'POST' });
      setMessage(`Approval ${id} marked as approved.`);
      await loadApprovals();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve trade');
    }
  }

  async function handleReject(id: number) {
    const reason = typeof window !== 'undefined' ? window.prompt('Enter rejection reason (optional):') : null;
    try {
      setMessage(null);
      setError(null);
      await fetchJson(`/api/admin/approvals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      setMessage(`Approval ${id} rejected.`);
      await loadApprovals();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject trade');
    }
  }

  return (
    <>
      <Head>
        <title>Admin · Trade Approvals</title>
      </Head>
      <DashboardLayout topRightSlot={<span>{session?.user?.email ?? session?.user?.name ?? ''}</span>}>
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          <Card style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              <h1 style={{ margin: 0 }}>Trade Approvals</h1>
              <p style={{ margin: 0, color: '#94A3B8' }}>
                Monitor and action trades that exceed configured policy thresholds.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <Badge tone={statusFilter === 'pending' ? 'warning' : 'neutral'}>
                Pending: {pendingCount}
              </Badge>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: 10,
                  border: '1px solid rgba(148,163,184,0.25)',
                  background: 'rgba(15,23,42,0.6)',
                  color: '#E2E8F0',
                }}
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <Button variant="ghost" onClick={loadApprovals}>
                Refresh
              </Button>
            </div>
          </Card>

          {message ? (
            <Card glass style={{ border: '1px solid rgba(34,197,94,0.35)', color: '#BBF7D0' }}>{message}</Card>
          ) : null}
          {error ? (
            <Card glass style={{ border: '1px solid rgba(248,113,113,0.35)', color: '#FCA5A5' }}>{error}</Card>
          ) : null}

          <Card style={{ display: 'grid', gap: '1rem' }}>
            {loading ? (
              <p style={{ margin: 0, color: '#94A3B8' }}>Loading approvals…</p>
            ) : approvals.length === 0 ? (
              <p style={{ margin: 0, color: '#94A3B8' }}>No approvals found for the selected filter.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {approvals.map((approval) => (
                  <Card key={approval.id} elevation="none" glass={false} style={{ padding: '1rem', display: 'grid', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <h3 style={{ margin: 0 }}>Approval #{approval.id}</h3>
                        <p style={{ margin: '0.25rem 0 0', color: '#94A3B8' }}>
                          Client: <strong>{approval.clientId}</strong> · Strategy: {approval.strategyId ?? '—'} · Type:{' '}
                          {approval.tradeType}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <Badge tone={approval.status === 'approved' ? 'success' : approval.status === 'rejected' ? 'warning' : 'neutral'}>
                          {approval.status.toUpperCase()}
                        </Badge>
                        {approval.status === 'pending' ? (
                          <>
                            <Button size="sm" onClick={() => handleApprove(approval.id)}>
                              Approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleReject(approval.id)}>
                              Reject
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', color: '#C8D3F5', fontSize: '0.9rem' }}>
                      <span>Requested by {approval.requestedBy}</span>
                      <span>Requested at {formatDate(approval.requestedAt)}</span>
                      <span>Amount {formatAmount(approval.amountUsd)}</span>
                      {approval.thresholdReason ? <span>Trigger: {approval.thresholdReason}</span> : null}
                      {approval.correlationId ? <span>Correlation: {approval.correlationId}</span> : null}
                    </div>
                    {approval.metadata ? (
                      <pre style={{ margin: 0, background: 'rgba(15,23,42,0.6)', padding: '0.75rem', borderRadius: 12 }}>
                        {JSON.stringify(approval.metadata, null, 2)}
                      </pre>
                    ) : null}
                    {approval.approvedBy && approval.approvedBy.length ? (
                      <p style={{ margin: 0, color: '#94A3B8', fontSize: '0.85rem' }}>
                        Decision by {approval.approvedBy.join(', ')} at {formatDate(approval.approvedAt)}
                      </p>
                    ) : null}
                  </Card>
                ))}
              </div>
            )}
          </Card>
        </div>
      </DashboardLayout>
    </>
  );
}
