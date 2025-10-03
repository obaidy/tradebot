import { CSSProperties, ReactNode } from 'react';
import { layout, palette } from '../../styles/theme';

export interface CardProps {
  children: ReactNode;
  padding?: string;
  elevation?: 'base' | 'raised' | 'none';
  glass?: boolean;
  hoverLift?: boolean;
  style?: CSSProperties;
  className?: string;
}

const baseStyle: CSSProperties = {
  borderRadius: layout.borderRadius,
  border: layout.glassBorder,
  background: palette.glass,
  padding: layout.cardPadding,
  boxShadow: layout.shadow,
  position: 'relative',
  overflow: 'hidden',
  backdropFilter: 'blur(14px)',
};

export function Card({
  children,
  padding,
  elevation = 'base',
  glass = true,
  hoverLift = false,
  style,
  className,
}: CardProps) {
  const cardStyle: CSSProperties = {
    ...baseStyle,
    padding: padding ?? baseStyle.padding,
    border: glass ? baseStyle.border : '1px solid rgba(148, 163, 184, 0.08)',
    background: glass ? baseStyle.background : palette.surface,
    boxShadow:
      elevation === 'raised'
        ? '0 35px 70px rgba(15, 23, 42, 0.55)'
        : elevation === 'none'
        ? 'none'
        : baseStyle.boxShadow,
    ...style,
  };

  const hoverStyle: CSSProperties = hoverLift
    ? {
        transition: 'transform 0.35s ease, box-shadow 0.35s ease',
        willChange: 'transform',
      }
    : {};

  return (
    <div
      className={className}
      style={hoverLift ? { ...cardStyle, ...hoverStyle } : cardStyle}
      onMouseEnter={(event) => {
        if (!hoverLift) return;
        event.currentTarget.style.transform = 'translateY(-6px)';
        event.currentTarget.style.boxShadow = '0 35px 70px rgba(15, 23, 42, 0.55)';
      }}
      onMouseLeave={(event) => {
        if (!hoverLift) return;
        event.currentTarget.style.transform = 'translateY(0)';
        event.currentTarget.style.boxShadow = cardStyle.boxShadow || 'none';
      }}
    >
      {children}
    </div>
  );
}
