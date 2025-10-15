import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { RouteProp, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { useTheme } from '@/theme';
import { Surface } from '@/components/Surface';
import { ThemedText } from '@/components/ThemedText';
import { PrimaryButton } from '@/components/PrimaryButton';
import { StatusPill } from '@/components/StatusPill';
import type { RootStackParamList } from '@/navigation/AppNavigator';
import {
  useControlStrategyMutation,
  useGetStrategyDetailQuery,
  tradebotApi,
} from '@/services/api';
import type { StrategyStatus } from '@/services/types';
import { useAppDispatch } from '@/hooks/store';
import { formatApiError } from '@/utils/error';

const formatRelativeTime = (iso?: string | null) => {
  if (!iso) return 'Unknown';
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return 'Unknown';
  const diff = Date.now() - timestamp;
  if (diff < 30 * 1000) return 'Just now';
  if (diff < 60 * 1000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}h ago`;
  return new Date(iso).toLocaleString();
};

const formatPercent = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
};

const formatAllocation = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Unassigned';
  const pct = Math.abs(value) <= 1 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
};

const configToString = (config?: Record<string, unknown> | null) => {
  if (!config) return 'Configuration snapshot unavailable.';
  try {
    return JSON.stringify(config, null, 2);
  } catch {
    return 'Unable to render configuration snapshot.';
  }
};

interface Props {
  route: RouteProp<RootStackParamList, 'StrategyDetail'>;
}

export const StrategyDetailScreen: React.FC<Props> = ({ route }) => {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const dispatch = useAppDispatch();
  const { strategyId, preview } = route.params;

  const {
    data: detail,
    isFetching,
    refetch,
    error,
  } = useGetStrategyDetailQuery(strategyId);

  const [controlStrategy, { isLoading: controlling }] = useControlStrategyMutation();
  const [controlError, setControlError] = useState<string | null>(null);
  const [controlNotice, setControlNotice] = useState<string | null>(null);

  const strategy: StrategyStatus | undefined = detail?.strategy ?? preview;

  useEffect(() => {
    if (strategy?.name) {
      navigation.setOptions({ title: strategy.name });
    }
  }, [navigation, strategy?.name]);

  const detailErrorMessage = error ? formatApiError(error, 'Unable to load strategy detail.') : null;

  const statusTone: 'positive' | 'negative' | 'warning' | 'neutral' = !strategy
    ? 'neutral'
    : strategy.status === 'running'
    ? 'positive'
    : strategy.status === 'error'
    ? 'negative'
    : 'warning';

  const runModeTone: 'positive' | 'neutral' = strategy?.runMode === 'live' ? 'positive' : 'neutral';
  const runs = detail?.recentRuns ?? [];

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

  const handleToggle = useCallback(async () => {
    if (!strategy) return;
    setControlError(null);
    setControlNotice(null);
    const nextStatus = strategy.status === 'running' ? 'paused' : 'running';
    const biometricSignature = await promptBiometric(nextStatus === 'running' ? 'Resume strategy' : 'Pause strategy');

    const detailPatch = dispatch(
      tradebotApi.util.updateQueryData('getStrategyDetail', strategyId, (draft) => {
        if (draft) {
          draft.strategy.status = nextStatus;
        }
      })
    );
    const listPatch = dispatch(
      tradebotApi.util.updateQueryData('getStrategies', undefined, (draft) => {
        if (!draft) return;
        const target = draft.find((item) => item.strategyId === strategy.strategyId);
        if (target) {
          target.status = nextStatus;
        }
      })
    );

    try {
      await controlStrategy({
        strategyId: strategy.strategyId,
        action: nextStatus === 'running' ? 'resume' : 'pause',
        confirmToken: Crypto.randomUUID(),
        biometricSignature,
      }).unwrap();
      setControlNotice(`Strategy ${nextStatus === 'running' ? 'resumed' : 'paused'}.`);
      await refetch();
    } catch (err) {
      detailPatch?.undo?.();
      listPatch?.undo?.();
      if (err instanceof Error && err.message === 'Action cancelled') {
        return;
      }
      setControlError(formatApiError(err, 'Unable to update strategy.'));
    }
  }, [controlStrategy, dispatch, promptBiometric, refetch, strategy, strategyId]);

  if (!strategy && isFetching) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: theme.colors.background,
        }}
      >
        <ActivityIndicator color={theme.colors.accent} />
        <ThemedText variant="caption" muted style={{ marginTop: theme.spacing(1) }}>
          Loading strategy details…
        </ThemedText>
      </View>
    );
  }

  if (!strategy) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: theme.spacing(3),
          backgroundColor: theme.colors.background,
        }}
      >
        <ThemedText variant="body" style={{ color: theme.colors.negative, textAlign: 'center' }}>
          {detailErrorMessage ?? 'Strategy details are unavailable.'}
        </ThemedText>
        <PrimaryButton
          label="Retry"
          variant="primary"
          style={{ marginTop: theme.spacing(2) }}
          onPress={() => refetch()}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing(2), gap: theme.spacing(2) }}
      refreshControl={<RefreshControl tintColor={theme.colors.accent} refreshing={isFetching} onRefresh={refetch} />}
    >
      <Surface variant="secondary" style={{ gap: theme.spacing(1) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <StatusPill label={strategy.status.toUpperCase()} tone={statusTone} />
          <StatusPill label={strategy.runMode.toUpperCase()} tone={runModeTone} />
        </View>
        <ThemedText variant="headline" weight="bold">
          {strategy.name}
        </ThemedText>
        <ThemedText variant="caption" muted>
          {strategy.strategyId}
        </ThemedText>
        <View style={{ flexDirection: 'row', gap: theme.spacing(1), marginTop: theme.spacing(1) }}>
          <PrimaryButton
            label={strategy.status === 'running' ? 'Pause Strategy' : 'Resume Strategy'}
            onPress={() =>
              handleToggle().catch((err) => {
                if (err instanceof Error && err.message === 'Action cancelled') return;
              })
            }
            loading={controlling}
            variant={strategy.status === 'running' ? 'secondary' : 'primary'}
          />
          <PrimaryButton label="Refresh" variant="secondary" onPress={() => refetch()} disabled={isFetching} />
        </View>
        {controlNotice ? (
          <ThemedText variant="caption" style={{ color: theme.colors.positive }}>
            {controlNotice}
          </ThemedText>
        ) : null}
        {controlError ? (
          <ThemedText variant="caption" style={{ color: theme.colors.negative }}>
            {controlError}
          </ThemedText>
        ) : null}
        {detailErrorMessage ? (
          <ThemedText variant="caption" style={{ color: theme.colors.negative }}>
            {detailErrorMessage}
          </ThemedText>
        ) : null}
      </Surface>

      <Surface variant="secondary" style={{ gap: theme.spacing(0.75) }}>
        <ThemedText variant="title" weight="medium">
          Allocation & Performance
        </ThemedText>
        <ThemedText variant="body">
          Allocation: {formatAllocation(detail?.allocationPct ?? null)} ({detail?.allocationRunMode?.toUpperCase() ?? strategy.runMode.toUpperCase()})
        </ThemedText>
        <ThemedText variant="body">
          Last run: {formatRelativeTime(strategy.lastRunAt)}
        </ThemedText>
        <ThemedText variant="body">
          Lifetime PnL: {formatPercent(strategy.pnlPct)}
        </ThemedText>
      </Surface>

      <Surface variant="secondary" style={{ gap: theme.spacing(1) }}>
        <ThemedText variant="title" weight="medium">
          Recent Runs
        </ThemedText>
        {runs.length ? (
          runs.map((run) => (
            <Surface key={run.runId} variant="primary" style={{ gap: theme.spacing(0.5) }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <ThemedText weight="medium">{run.status.toUpperCase()}</ThemedText>
                <StatusPill
                  label={formatPercent(run.pnlPct ?? null)}
                  tone={
                    typeof run.pnlPct === 'number'
                      ? run.pnlPct >= 0
                        ? 'positive'
                        : 'negative'
                      : 'neutral'
                  }
                />
              </View>
              <ThemedText variant="caption" muted>
                Started {formatRelativeTime(run.startedAt)} • Ended {formatRelativeTime(run.endedAt)}
              </ThemedText>
              {run.notes ? (
                <ThemedText variant="caption" muted>
                  {run.notes}
                </ThemedText>
              ) : null}
            </Surface>
          ))
        ) : (
          <ThemedText muted>No recent executions recorded.</ThemedText>
        )}
      </Surface>

      <Surface variant="secondary" style={{ gap: theme.spacing(1) }}>
        <ThemedText variant="title" weight="medium">
          Configuration Snapshot
        </ThemedText>
        <Surface variant="primary" style={{ padding: theme.spacing(1.5) }}>
          <ThemedText
            variant="caption"
            style={{
              fontFamily: Platform.select({ ios: 'Courier', macos: 'Courier', default: 'monospace' }),
              color: theme.colors.textPrimary,
            }}
          >
            {configToString(detail?.lastConfig ?? null)}
          </ThemedText>
        </Surface>
      </Surface>
    </ScrollView>
  );
};
