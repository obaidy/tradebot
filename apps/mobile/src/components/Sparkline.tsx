import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme';

interface Props {
  data?: number[];
  color?: string;
  height?: number;
}

export const Sparkline: React.FC<Props> = ({ data, color, height = 40 }) => {
  const theme = useTheme();
  const values = data && data.length ? data : [0];
  const [min, max] = useMemo(() => {
    const localMin = Math.min(...values);
    const localMax = Math.max(...values);
    if (localMax === localMin) {
      return [localMin - 1, localMax + 1];
    }
    return [localMin, localMax];
  }, [values]);

  const tone = color ?? theme.colors.accent;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        height,
      }}
    >
      {values.map((value, index) => {
        const normalized = (value - min) / (max - min);
        const clamped = Number.isFinite(normalized) ? Math.max(0.05, normalized) : 0.5;
        const barHeight = clamped * height;
        return (
          <View
            key={`spark-${index}`}
            style={{
              flex: 1,
              marginHorizontal: values.length > 32 ? 0 : 1,
              borderRadius: theme.radii.sm,
              height: Math.max(2, barHeight),
              backgroundColor: tone,
              opacity: 0.8,
            }}
          />
        );
      })}
    </View>
  );
};
