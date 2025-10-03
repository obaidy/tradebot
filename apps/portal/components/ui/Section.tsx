import { CSSProperties, ReactNode } from 'react';
import { layout } from '../../styles/theme';

export interface SectionProps {
  children: ReactNode;
  align?: 'left' | 'center';
  style?: CSSProperties;
  spacing?: string;
  id?: string;
  className?: string;
  containerClassName?: string;
}

export function Section({ children, align = 'left', style, spacing, id, className, containerClassName }: SectionProps) {
  return (
    <section
      id={id}
      className={className}
      style={{
        padding: spacing ?? layout.sectionSpacing + ' 0',
        textAlign: align === 'center' ? 'center' : undefined,
        ...style,
      }}
    >
      <div
        className={`container${containerClassName ? ` ${containerClassName}` : ''}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2.5rem',
          alignItems: align === 'center' ? 'center' : undefined,
        }}
      >
        {children}
      </div>
    </section>
  );
}
