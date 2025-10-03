import { ButtonHTMLAttributes, CSSProperties, forwardRef } from 'react';
import { palette, typography } from '../../styles/theme';

type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'minimal';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  size?: ButtonSize;
}

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
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: 'rgba(15, 23, 42, 0.6)',
  color: palette.textPrimary,
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.35)',
};

const ghostStyle: CSSProperties = {
  ...baseStyle,
  padding: '0.75rem 1.25rem',
  background: 'transparent',
  border: '1px solid rgba(148,163,184,0.24)',
  color: palette.textPrimary,
};

const minimalStyle: CSSProperties = {
  ...baseStyle,
  padding: '0.7rem 1.1rem',
  background: 'transparent',
  border: 'none',
  color: palette.textPrimary,
  boxShadow: 'none',
};

const sizeStyles: Record<ButtonSize, CSSProperties> = {
  sm: {
    padding: '0.6rem 1rem',
    fontSize: '0.85rem',
    gap: '0.4rem',
    borderRadius: '12px',
  },
  md: {},
  lg: {
    padding: '1rem 1.8rem',
    fontSize: '1rem',
    borderRadius: '20px',
  },
};

function getVariantStyle(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case 'primary':
      return primaryStyle;
    case 'secondary':
      return secondaryStyle;
    case 'ghost':
      return ghostStyle;
    case 'minimal':
    default:
      return minimalStyle;
  }
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', fullWidth, size = 'md', style, ...props }, ref) => {
    const variantStyle = getVariantStyle(variant);
    const sizeStyle = sizeStyles[size] ?? sizeStyles.md;

    return (
      <button
        ref={ref}
        style={{
          ...variantStyle,
          ...sizeStyle,
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
          } else if (variant === 'ghost') {
            target.style.borderColor = 'rgba(56,189,248,0.35)';
            target.style.background = 'rgba(56,189,248,0.1)';
          } else {
            target.style.background = 'rgba(56,189,248,0.12)';
          }
        }}
        onMouseOut={(event) => {
          if (props.onMouseOut) props.onMouseOut(event);
          const target = event.currentTarget;
          if (variant === 'primary') {
            target.style.transform = 'translateY(0)';
            target.style.boxShadow = (primaryStyle.boxShadow as string) || '';
          } else if (variant === 'secondary') {
            target.style.border = typeof secondaryStyle.border === 'string' ? secondaryStyle.border : '';
            target.style.background = secondaryStyle.background as string;
          } else if (variant === 'ghost') {
            target.style.border = typeof ghostStyle.border === 'string' ? ghostStyle.border : '';
            target.style.background = ghostStyle.background as string;
          } else {
            target.style.background = minimalStyle.background as string;
          }
        }}
      />
    );
  }
);

Button.displayName = 'Button';
