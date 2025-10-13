import React, { useState } from 'react';
import { View, TextInput } from 'react-native';
import { useTheme } from '@/theme';
import { ThemedText } from '@/components/ThemedText';
import { PrimaryButton } from '@/components/PrimaryButton';

interface Props {
  onSubmit: (code: string) => Promise<void>;
  onCancel: () => void;
}

export const Verify2FAScreen: React.FC<Props> = ({ onSubmit, onCancel }) => {
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit(code.trim());
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View
      style={{
        padding: theme.spacing(2),
        gap: theme.spacing(2),
      }}
    >
      <ThemedText variant="title" weight="medium">
        Enter 2FA Code
      </ThemedText>
      <TextInput
        inputMode="numeric"
        keyboardType="number-pad"
        value={code}
        onChangeText={setCode}
        maxLength={6}
        placeholder="123456"
        placeholderTextColor={theme.colors.textSecondary}
        style={{
          backgroundColor: theme.colors.surfaceAlt,
          color: theme.colors.textPrimary,
          padding: theme.spacing(1.5),
          borderRadius: theme.radii.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          fontSize: theme.typography.sizes.lg,
          letterSpacing: 12,
          textAlign: 'center',
        }}
      />
      {error ? (
        <ThemedText variant="body" style={{ color: theme.colors.negative }}>
          {error}
        </ThemedText>
      ) : null}
      <PrimaryButton label="Verify" onPress={handleSubmit} loading={loading} disabled={code.length < 6} />
      <PrimaryButton label="Cancel" onPress={onCancel} variant="secondary" />
    </View>
  );
};
