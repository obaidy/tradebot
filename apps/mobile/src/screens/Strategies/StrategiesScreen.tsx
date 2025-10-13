import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { useTheme } from '@/theme';
import { Surface } from '@/components/Surface';
import { ThemedText } from '@/components/ThemedText';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useGetStrategiesQuery, useControlStrategyMutation } from '@/services/api';
import type { StrategyStatus } from '@/services/types';

export const StrategiesScreen: React.FC = () => {
  const theme = useTheme();
  const { data: strategies, isFetching, refetch } = useGetStrategiesQuery();
  const [controlStrategy, { isLoading: controlling }] = useControlStrategyMutation();
  const [controlError, setControlError] = useState<string | null>(null);

  const promptBiometric = useCallback(async (promptMessage: string) => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      requireConfirmation: true,
    });
    if (!result.success) {
      const message = result.error === 'user_cancel' ? 'Action cancelled' : result.error ?? 'Biometric confirmation failed';
      throw new Error(message);
    }
    const signature = (result as { signature?: string }).signature;
    return typeof signature === 'string' ? signature : undefined;
  }, []);

  const handleToggle = useCallback(
    async (item: StrategyStatus) => {
      setControlError(null);
      const biometricSignature = await promptBiometric(
        item.status === 'running' ? 'Pause strategy' : 'Resume strategy'
      );
      await controlStrategy({
        strategyId: item.strategyId,
        action: item.status === 'running' ? 'pause' : 'resume',
        confirmToken: Crypto.randomUUID(),
        biometricSignature,
      }).unwrap();
    },
    [controlStrategy, promptBiometric]
  );

  const renderItem = useCallback(
    ({ item }: { item: StrategyStatus }) => (
      <Surface style={{ marginBottom: theme.spacing(2) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <ThemedText weight="medium">{item.name}</ThemedText>
            <ThemedText variant="caption" muted>
              {item.strategyId} • {(item.pnlPct ?? 0).toFixed(2)}%
            </ThemedText>
          </View>
          <PrimaryButton
            label={item.status === 'running' ? 'Pause' : 'Resume'}
            variant={item.status === 'running' ? 'secondary' : 'primary'}
            loading={controlling}
            onPress={() =>
              handleToggle(item).catch((error) => {
                if (error instanceof Error && error.message === 'Action cancelled') return;
                setControlError(error instanceof Error ? error.message : 'Unable to update strategy');
              })
            }
          />
        </View>
      </Surface>
    ),
    [controlling, handleToggle, theme]
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing(2) }}
      data={strategies ?? []}
      keyExtractor={(item) => item.strategyId}
      onRefresh={refetch}
      refreshing={isFetching}
      renderItem={renderItem}
      ListHeaderComponent={
        controlError ? (
          <View style={{ paddingBottom: theme.spacing(1) }}>
            <ThemedText variant="caption" style={{ color: theme.colors.negative }}>
              {controlError}
            </ThemedText>
          </View>
        ) : undefined
      }
      ListEmptyComponent={() => (
        <View style={{ padding: theme.spacing(4) }}>
          <ThemedText muted>No strategies available.</ThemedText>
        </View>
      )}
    />
  );
};
