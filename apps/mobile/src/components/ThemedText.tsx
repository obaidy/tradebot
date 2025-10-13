import React from 'react';
import { Text, TextProps, TextStyle } from 'react-native';
import { Theme, useTheme } from '@/theme';

type Variant = 'label' | 'body' | 'caption' | 'title' | 'headline';

type VariantKey = keyof Theme['typography']['sizes'];

type Props = TextProps & {
  variant?: Variant;
  weight?: 'regular' | 'medium' | 'bold';
  muted?: boolean;
};

const variantMap: Record<Variant, keyof Theme['typography']['sizes']> = {
  caption: 'xs',
  label: 'sm',
  body: 'md',
  title: 'xl',
  headline: 'hero',
};

export const ThemedText: React.FC<Props> = ({
  variant = 'body',
  weight = 'regular',
  muted = false,
  style,
  children,
  ...rest
}) => {
  const theme = useTheme();
  const sizeKey = variantMap[variant] as VariantKey;
  const fontWeight: TextStyle['fontWeight'] = (
    weight === 'regular'
      ? theme.typography.weightRegular
      : weight === 'medium'
      ? theme.typography.weightMedium
      : theme.typography.weightBold
  ) as TextStyle['fontWeight'];

  return (
    <Text
      style={[
        {
          color: muted ? theme.colors.textSecondary : theme.colors.textPrimary,
          fontFamily: theme.typography.fontFamily,
          fontWeight,
          fontSize: theme.typography.sizes[sizeKey],
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
};
