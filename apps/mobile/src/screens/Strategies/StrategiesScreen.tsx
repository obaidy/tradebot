import React, { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { useTheme } from '@/theme';
import { Surface } from '@/components/Surface';
import { ThemedText } from '@/components/ThemedText';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useGetStrategiesQuery, useControlStrategyMutation, tradebotApi } from '@/services/api';
import type { StrategyStatus } from '@/services/types';
import { useAppDispatch, useAppSelector } from '@/hooks/store';
import { formatApiError } from '@/utils/error';
import type { RootStackParamList } from '@/navigation/AppNavigator';

export const StrategiesScreen: React.FC = () => {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const networkStatus = useAppSelector((state) => state.app.networkStatus);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: strategies, isFetching, refetch, error } = useGetStrategiesQuery();
  const [controlStrategy, { isLoading: controlling }] = useControlStrategyMutation();
  const [controlError, setControlError] = useState<string | null>(null);
  const [pendingStrategyId, setPendingStrategyId] = useState<string | null>(null);
  const strategiesErrorMessage = error ? formatApiError(error, 'Failed to load strategies') : null;

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
      const intent = item.status === 'running' ? 'Pause strategy' : 'Resume strategy';
      const biometricSignature = await promptBiometric(intent);
      const nextStatus = item.status === 'running' ? 'paused' : 'running';
      setPendingStrategyId(item.strategyId);
      const patchResult = dispatch(
        tradebotApi.util.updateQueryData('getStrategies', undefined, (draft) => {
          if (!draft) return;
          const target = draft.find((strategy) => strategy.strategyId === item.strategyId);
          if (target) {
            target.status = nextStatus;
          }
        })
      );
      try {
        await controlStrategy({
          strategyId: item.strategyId,
          action: nextStatus === 'running' ? 'resume' : 'pause',
          confirmToken: Crypto.randomUUID(),
          biometricSignature,
        }).unwrap();
        await refetch();
      } catch (err) {
        patchResult?.undo?.();
        if (err instanceof Error && err.message === 'Action cancelled') {
          throw err;
        }
        const message = formatApiError(err, 'Unable to update strategy');
        setControlError(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        setPendingStrategyId(null);
      }
    },
    [controlStrategy, dispatch, promptBiometric, refetch]
  );

  const renderItem = useCallback(
    ({ item }: { item: StrategyStatus }) => (
      <Surface style={{ marginBottom: theme.spacing(2), gap: theme.spacing(1.25) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: theme.spacing(1) }}>
            <ThemedText weight="medium">{item.name}</ThemedText>
            <ThemedText variant="caption" muted>
              {item.strategyId} • {(item.pnlPct ?? 0).toFixed(2)}%
            </ThemedText>
            {!item.hasAllocation ? (
              <ThemedText variant="caption" muted style={{ marginTop: theme.spacing(0.25) }}>
                Not yet allocated – configure from the web dashboard.
              </ThemedText>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', gap: theme.spacing(1) }}>
            <PrimaryButton
              label={item.status === 'running' ? 'Pause' : 'Resume'}
              variant={item.status === 'running' ? 'secondary' : 'primary'}
              loading={controlling || pendingStrategyId === item.strategyId}
              disabled={!item.hasAllocation || (pendingStrategyId !== null && pendingStrategyId !== item.strategyId)}
              onPress={() =>
                handleToggle(item).catch((error) => {
                  if (error instanceof Error && error.message === 'Action cancelled') return;
                  setControlError(formatApiError(error, 'Unable to update strategy'));
                })
              }
            />
            <PrimaryButton
              label="Details"
              variant="secondary"
              disabled={!item.hasAllocation || (pendingStrategyId !== null && pendingStrategyId !== item.strategyId)}
              onPress={() => navigation.navigate('StrategyDetail', { strategyId: item.strategyId, preview: item })}
            />
          </View>
        </View>
      </Surface>
    ),
    [controlling, handleToggle, navigation, pendingStrategyId, theme]
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
        strategiesErrorMessage || controlError || networkStatus === 'offline' ? (
          <View style={{ paddingBottom: theme.spacing(1), gap: theme.spacing(0.5) }}>
            {strategiesErrorMessage ? (
              <ThemedText variant="caption" style={{ color: theme.colors.negative }}>
                {strategiesErrorMessage}
              </ThemedText>
            ) : null}
            {networkStatus === 'offline' ? (
              <ThemedText variant="caption" style={{ color: theme.colors.warning }}>
                Offline mode – strategy list will update when connectivity returns.
              </ThemedText>
            ) : null}
            {controlError ? (
              <ThemedText variant="caption" style={{ color: theme.colors.negative }}>
                {controlError}
              </ThemedText>
            ) : null}
          </View>
        ) : undefined
      }
      ListEmptyComponent={() => (
        <View style={{ padding: theme.spacing(4) }}>
          <ThemedText muted>
            {strategiesErrorMessage ?? 'No strategies available.'}
          </ThemedText>
        </View>
      )}
    />
  );
};
