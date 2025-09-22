import { CSSProperties, ReactNode } from 'react';
import { palette, typography } from '../../styles/theme';

export interface BadgeProps {
  children: ReactNode;
  tone?: 'primary' | 'neutral' | 'success' | 'warning';
  icon?: ReactNode;
  style?: CSSProperties;
}

type Tone = NonNullable<BadgeProps['tone']>;

const toneMap: Record<Tone, { background: string; border: string; color: string }> = {
  primary: {
    background: 'rgba(56, 189, 248, 0.12)',
    border: '1px solid rgba(56, 189, 248, 0.35)',
    color: palette.primary,
  },
  neutral: {
    background: 'rgba(148, 163, 184, 0.15)',
    border: '1px solid rgba(148, 163, 184, 0.24)',
    color: palette.textSecondary,
  },
  success: {
    background: 'rgba(34, 197, 94, 0.12)',
    border: '1px solid rgba(34, 197, 94, 0.24)',
    color: palette.success,
  },
  warning: {
    background: 'rgba(234, 179, 8, 0.12)',
    border: '1px solid rgba(234, 179, 8, 0.35)',
    color: '#fbbf24',
  },
};

export function Badge({ children, tone = 'primary', icon, style }: BadgeProps) {
  const toneStyle = toneMap[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        padding: '0.35rem 0.85rem',
        borderRadius: '999px',
        fontFamily: typography.fontFamily,
        fontSize: '0.75rem',
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        ...toneStyle,
        ...style,
      }}
    >
      {icon ? <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.9em' }}>{icon}</span> : null}
      {children}
    </span>
  );
}
