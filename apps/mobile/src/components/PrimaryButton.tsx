import React from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
  Pressable,
  StyleProp,
  Text,
  TextStyle,
  ViewStyle,
} from 'react-native';
import { useTheme } from '@/theme';

type Props = {
  label: string;
  onPress?: (event: GestureResponderEvent) => void;
  icon?: React.ReactNode;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'destructive';
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
};

export const PrimaryButton: React.FC<Props> = ({
  label,
  onPress,
  icon,
  loading = false,
  variant = 'primary',
  style,
  disabled = false,
}) => {
  const theme = useTheme();
  const backgroundColor =
    variant === 'destructive'
      ? theme.colors.negative
      : variant === 'secondary'
      ? theme.colors.surfaceAlt
      : theme.colors.accent;
  const color = variant === 'secondary' ? theme.colors.textPrimary : '#FFFFFF';

  const labelFontWeight: TextStyle['fontWeight'] = theme.typography.weightMedium as TextStyle['fontWeight'];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: theme.spacing(1.5),
          paddingHorizontal: theme.spacing(2),
          borderRadius: theme.radii.lg,
          backgroundColor,
          opacity: pressed || disabled ? 0.72 : 1,
        },
        style,
      ]}
    >
          {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <>
          {icon}
          <Text
            style={{
              color,
              fontFamily: theme.typography.fontFamily,
              fontWeight: labelFontWeight,
              fontSize: theme.typography.sizes.md,
              marginLeft: icon ? theme.spacing(1) : 0,
            }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
};
