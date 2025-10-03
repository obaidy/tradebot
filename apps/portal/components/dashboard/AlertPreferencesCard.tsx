import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

type AlertPreferences = {
  drawdownThreshold: number;
  slippageThresholdBps: number;
  emailEnabled: boolean;
  telegramEnabled: boolean;
};

const STORAGE_KEY = 'tradebot-alert-preferences';

const DEFAULT_PREFERENCES: AlertPreferences = {
  drawdownThreshold: 10,
  slippageThresholdBps: 25,
  emailEnabled: true,
  telegramEnabled: false,
};

type AlertPreferencesCardProps = {
  onSave?: (prefs: AlertPreferences) => void;
};

export function AlertPreferencesCard({ onSave }: AlertPreferencesCardProps) {
  const [prefs, setPrefs] = useState<AlertPreferences>(DEFAULT_PREFERENCES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AlertPreferences;
        setPrefs({ ...DEFAULT_PREFERENCES, ...parsed });
      }
    } catch {
      // ignore
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      }
      onSave?.(prefs);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <Badge tone="secondary">Alerts</Badge>
          <h2 style={{ margin: '0.5rem 0 0' }}>Custom notifications</h2>
          <p style={{ margin: 0, color: '#94A3B8' }}>
            Receive push/email summaries when drawdowns exceed thresholds or slippage crosses your tolerance.
          </p>
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <div>
          <label style={labelStyle}>Drawdown alert (%)</label>
          <input
            type="number"
            style={inputStyle}
            value={prefs.drawdownThreshold}
            min={1}
            max={80}
            onChange={(e) => setPrefs((prev) => ({ ...prev, drawdownThreshold: Number(e.target.value) }))}
          />
        </div>
        <div>
          <label style={labelStyle}>Slippage alert (bps)</label>
          <input
            type="number"
            style={inputStyle}
            value={prefs.slippageThresholdBps}
            min={1}
            max={500}
            onChange={(e) => setPrefs((prev) => ({ ...prev, slippageThresholdBps: Number(e.target.value) }))}
          />
        </div>
        <div style={toggleStyle}>
          <label style={labelStyle}>Email</label>
          <input
            type="checkbox"
            checked={prefs.emailEnabled}
            onChange={(e) => setPrefs((prev) => ({ ...prev, emailEnabled: e.target.checked }))}
          />
        </div>
        <div style={toggleStyle}>
          <label style={labelStyle}>Telegram</label>
          <input
            type="checkbox"
            checked={prefs.telegramEnabled}
            onChange={(e) => setPrefs((prev) => ({ ...prev, telegramEnabled: e.target.checked }))}
          />
        </div>
      </div>
      <div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save preferences'}
        </Button>
      </div>
    </Card>
  );
}

const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: '0.35rem',
  fontSize: '0.85rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#64748B',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.75rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(148,163,184,0.35)',
  background: 'rgba(15,23,42,0.55)',
  color: '#E2E8F0',
};

const toggleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.75rem 1rem',
  borderRadius: '0.75rem',
  background: 'rgba(15,23,42,0.45)',
};
