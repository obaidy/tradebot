import { CSSProperties, ReactNode } from 'react';
import { layout } from '../../styles/theme';

export interface SectionProps {
  children: ReactNode;
  align?: 'left' | 'center';
  style?: CSSProperties;
  spacing?: string;
  id?: string;
}

export function Section({ children, align = 'left', style, spacing, id }: SectionProps) {
  return (
    <section
      id={id}
      style={{
        padding: spacing ?? layout.sectionSpacing + ' 0',
        textAlign: align === 'center' ? 'center' : undefined,
        ...style,
      }}
    >
      <div
        className="container"
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
