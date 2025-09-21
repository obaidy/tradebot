import { CSSProperties } from 'react';
import { Card } from './Card';
import { palette, typography } from '../../styles/theme';
import { Sparkline } from './Sparkline';

export interface MetricCardProps {
  label: string;
  value: string;
  footer?: string;
  accent?: 'primary' | 'secondary' | 'success' | 'warning';
  trend?: number[];
  animated?: boolean;
  style?: CSSProperties;
}

const accentColor: Record<NonNullable<MetricCardProps['accent']>, string> = {
  primary: palette.primary,
  secondary: palette.secondary,
  success: palette.success,
  warning: palette.warning,
};

export function MetricCard({ label, value, footer, accent = 'primary', trend, animated, style }: MetricCardProps) {
  return (
    <Card hoverLift style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', ...style }}>
      <span
        style={{
          fontFamily: typography.fontFamily,
          fontSize: '0.75rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: accentColor[accent],
        }}
      >
        {label}
      </span>
      <strong style={{ fontSize: '1.6rem', letterSpacing: '-0.01em' }}>{value}</strong>
      {trend && trend.length > 1 ? (
        <Sparkline data={trend} width={190} height={60} animated={animated} />
      ) : null}
      {footer ? <span style={{ color: palette.textSecondary, fontSize: '0.85rem' }}>{footer}</span> : null}
    </Card>
  );
}
