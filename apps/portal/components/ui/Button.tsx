import { ButtonHTMLAttributes, CSSProperties, forwardRef } from 'react';
import { palette, typography } from '../../styles/theme';

const baseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.6rem',
  padding: '0.9rem 1.6rem',
  borderRadius: '999px',
  fontFamily: typography.fontFamily,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  transition: 'transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease, background 0.25s ease',
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
  border: `1px solid rgba(148, 163, 184, 0.35)`,
  background: 'rgba(17, 24, 39, 0.6)',
  color: palette.textPrimary,
};

const ghostStyle: CSSProperties = {
  ...baseStyle,
  padding: '0.75rem 1.2rem',
  background: 'transparent',
  border: `1px solid rgba(148,163,184,0.18)`,
  color: palette.textSecondary,
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
          target.style.borderColor = 'rgba(56, 189, 248, 0.35)';
          target.style.background = 'rgba(17, 24, 39, 0.8)';
        } else {
          target.style.borderColor = 'rgba(99,102,241,0.35)';
        }
      }}
      onMouseOut={(event) => {
        if (props.onMouseOut) props.onMouseOut(event);
        const target = event.currentTarget;
        if (variant === 'primary') {
          target.style.transform = 'translateY(0)';
          target.style.boxShadow = primaryStyle.boxShadow || '';
        } else if (variant === 'secondary') {
          target.style.borderColor = secondaryStyle.border as string;
          target.style.background = secondaryStyle.background as string;
        } else {
          target.style.borderColor = ghostStyle.border as string;
        }
      }}
    />
  );
});

Button.displayName = 'Button';
