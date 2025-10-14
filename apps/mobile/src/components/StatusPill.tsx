import React from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

type Tone = 'neutral' | 'positive' | 'negative' | 'warning';

const withAlpha = (hex: string, alpha: number) => {
  const sanitized = hex.replace('#', '');
  if (sanitized.length !== 6) return hex;
  const alphaHex = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${sanitized}${alphaHex}`;
};

interface Props {
  label: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}

export const StatusPill: React.FC<Props> = ({ label, tone = 'neutral', style }) => {
  const theme = useTheme();

  const palette = {
    neutral: {
      background: withAlpha(theme.colors.accentSoft, 0.35),
      color: theme.colors.accent,
    },
    positive: {
      background: withAlpha(theme.colors.positive, 0.18),
      color: theme.colors.positive,
    },
    negative: {
      background: withAlpha(theme.colors.negative, 0.18),
      color: theme.colors.negative,
    },
    warning: {
      background: withAlpha(theme.colors.warning, 0.18),
      color: theme.colors.warning,
    },
  } as const;

  const colors = palette[tone];

  return (
    <View
      style={[
        {
          backgroundColor: colors.background,
          paddingHorizontal: theme.spacing(1.5),
          paddingVertical: theme.spacing(0.5),
          borderRadius: theme.radii.lg,
        },
        style,
      ]}
    >
      <Text
        style={{
          color: colors.color,
          fontFamily: theme.typography.fontFamily,
          fontWeight: theme.typography.weightMedium as any,
          fontSize: theme.typography.sizes.sm,
        }}
      >
        {label}
      </Text>
    </View>
  );
};
