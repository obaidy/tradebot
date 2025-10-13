import React from 'react';
import { View, ViewProps } from 'react-native';
import { useTheme } from '@/theme';

export const Surface: React.FC<ViewProps & { variant?: 'primary' | 'secondary' }> = ({
  children,
  style,
  variant = 'primary',
  ...rest
}) => {
  const theme = useTheme();
  const backgroundColor = variant === 'primary' ? theme.colors.surface : theme.colors.surfaceAlt;

  return (
    <View
      style={[
        {
          backgroundColor,
          borderRadius: theme.radii.md,
          padding: theme.spacing(2),
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
};
