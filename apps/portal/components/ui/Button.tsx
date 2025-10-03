import { ButtonHTMLAttributes, CSSProperties, forwardRef } from 'react';
import { palette, typography } from '../../styles/theme';

const baseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '0.85rem 1.45rem',
  borderRadius: '16px',
  fontFamily: typography.fontFamily,
  fontSize: '0.95rem',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'none',
  cursor: 'pointer',
  transition: 'transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease, background 0.25s ease, color 0.25s ease',
};

const primaryStyle: CSSProperties = {
  ...baseStyle,
  border: 'none',
  color: palette.backgroundAlt,
  background: 'linear-gradient(120deg, #0EA5E9 0%, #6366F1 100%)',
  boxShadow: '0 18px 35px rgba(14, 165, 233, 0.35)',
};

const secondaryStyle: CSSProperties = {
  ...baseStyle,
  border: `1px solid rgba(148, 163, 184, 0.4)`,
  background: 'rgba(15, 23, 42, 0.6)',
  color: palette.textPrimary,
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.35)',
};

const ghostStyle: CSSProperties = {
  ...baseStyle,
  padding: '0.75rem 1.25rem',
  background: 'transparent',
  border: `1px solid rgba(148,163,184,0.24)`,
  color: palette.textPrimary,
};

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ variant = 'primary', fullWidth, style, ...props }, ref) => {
  const variantStyle = variant === 'primary' ? primaryStyle : variant === 'secondary' ? secondaryStyle : ghostStyle;
  return (
    <button
      ref={ref}
      style={{
        ...variantStyle,
        width: fullWidth ? '100%' : undefined,
        ...style,
      }}
      {...props}
      onMouseOver={(event) => {
        if (props.onMouseOver) props.onMouseOver(event);
        const target = event.currentTarget;
        if (variant === 'primary') {
          target.style.transform = 'translateY(-2px)';
          target.style.boxShadow = '0 24px 48px rgba(99, 102, 241, 0.4)';
        } else if (variant === 'secondary') {
          target.style.borderColor = 'rgba(56, 189, 248, 0.45)';
          target.style.background = 'rgba(15, 23, 42, 0.75)';
        } else {
          target.style.borderColor = 'rgba(56,189,248,0.35)';
          target.style.background = 'rgba(56,189,248,0.1)';
        }
      }}
      onMouseOut={(event) => {
        if (props.onMouseOut) props.onMouseOut(event);
        const target = event.currentTarget;
        if (variant === 'primary') {
          target.style.transform = 'translateY(0)';
          target.style.boxShadow = primaryStyle.boxShadow || '';
        } else if (variant === 'secondary') {
          target.style.borderColor = (secondaryStyle.border as string) || 'rgba(148,163,184,0.4)';
          target.style.background = secondaryStyle.background as string;
        } else {
          target.style.borderColor = ghostStyle.border as string;
          target.style.background = ghostStyle.background as string;
        }
      }}
    />
  );
});

Button.displayName = 'Button';
