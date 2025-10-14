import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { Surface } from '@/components/Surface';
import { ThemedText } from '@/components/ThemedText';
import { PrimaryButton } from '@/components/PrimaryButton';
import { StatusPill } from '@/components/StatusPill';
import { useTheme } from '@/theme';
import { useAppSelector } from '@/hooks/store';
import {
  useGetActivityFeedQuery,
  useGetDashboardSummaryQuery,
  useTriggerKillSwitchMutation,
  usePauseAllControlsMutation,
  useResumeAllControlsMutation,
  useControlStrategyMutation,
} from '@/services/api';
import type { ActivityEntry, DashboardSummaryResponse, StrategyStatus } from '@/services/types';
import { loadActivitySnapshot, loadDashboardSnapshot } from '@/services/offlineCache';

type QuickAction = {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  run: () => Promise<void>;
  confirm?: { title: string; message: string; confirmLabel?: string };
  successMessage?: string;
  loading?: boolean;
  disabled?: boolean;
};

const formatCurrency = (value?: number | null, maximumFractionDigits = 0) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits,
  }).format(value);
};

const formatPercent = (value?: number | null, fractionDigits = 2) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '--';
  return `${value.toFixed(fractionDigits)}%`;
};

const formatRelativeTime = (iso?: string) => {
  if (!iso) return 'Waiting for data…';
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return 'Updated recently';
  const diff = Date.now() - timestamp;
  if (diff < 30 * 1000) return 'Just now';
  if (diff < 60 * 1000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}h ago`;
  return new Date(iso).toLocaleString();
};

const guardCopy: Record<DashboardSummaryResponse['risk']['guardState'], string> = {
  nominal: 'Nominal',
  warning: 'Warning',
  critical: 'Critical',
};

const guardToneMap: Record<DashboardSummaryResponse['risk']['guardState'], 'positive' | 'warning' | 'negative'> = {
  nominal: 'positive',
  warning: 'warning',
  critical: 'negative',
};

const severityToneMap = {
  critical: 'negative',
  warn: 'warning',
  info: 'neutral',
} as const;

export const DashboardScreen: React.FC = () => {
  const theme = useTheme();
  const websocketConnected = useAppSelector((state) => state.app.websocketConnected);
  const lastSyncedAt = useAppSelector((state) => state.app.lastSyncedAt);

  const { data: summary, isLoading, refetch, isFetching } = useGetDashboardSummaryQuery();
  const { data: activity } = useGetActivityFeedQuery({ cursor: undefined });
  const [triggerKillSwitch, { isLoading: killLoading }] = useTriggerKillSwitchMutation();
  const [pauseAllControls, { isLoading: pauseLoading }] = usePauseAllControlsMutation();
  const [resumeAllControls, { isLoading: resumeLoading }] = useResumeAllControlsMutation();
  const [controlStrategy] = useControlStrategyMutation();

  const [cachedSummary, setCachedSummary] = useState<DashboardSummaryResponse | null>(null);
  const [cachedActivity, setCachedActivity] = useState<ActivityEntry[]>([]);
  const [controlError, setControlError] = useState<string | null>(null);
  const [controlNotice, setControlNotice] = useState<string | null>(null);
  const [strategyBusy, setStrategyBusy] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardSnapshot().then((cached) => {
      if (cached?.snapshot) setCachedSummary(cached.snapshot);
    });
    loadActivitySnapshot().then((cached) => {
      if (cached?.entries) setCachedActivity(cached.entries);
    });
  }, []);

  const summaryData = summary ?? cachedSummary;
  const activityEntries = activity?.entries ?? cachedActivity;
  const isInitialLoading = isLoading && !summaryData;

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const promptBiometric = useCallback(async (promptMessage: string) => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      requireConfirmation: true,
    });
    if (!result.success) {
      const errorMessage = result.error === 'user_cancel' ? 'Action cancelled' : result.error ?? 'Biometric confirmation failed';
      throw new Error(errorMessage);
    }
    const signature = (result as { signature?: string }).signature;
    return typeof signature === 'string' ? signature : undefined;
  }, []);

  const handleKillSwitch = useCallback(async () => {
    const biometricSignature = await promptBiometric('Confirm Kill Switch');
    await triggerKillSwitch({
      reason: 'Triggered from mobile quick action',
      confirmToken: Crypto.randomUUID(),
      biometricSignature,
    }).unwrap();
  }, [promptBiometric, triggerKillSwitch]);

  const handlePauseAll = useCallback(async () => {
    const biometricSignature = await promptBiometric('Pause all strategies');
    await pauseAllControls({
      confirmToken: Crypto.randomUUID(),
      biometricSignature,
    }).unwrap();
  }, [pauseAllControls, promptBiometric]);

  const handleResumeAll = useCallback(async () => {
    const biometricSignature = await promptBiometric('Resume all strategies');
    await resumeAllControls({
      confirmToken: Crypto.randomUUID(),
      biometricSignature,
    }).unwrap();
  }, [promptBiometric, resumeAllControls]);

  const executeQuickAction = useCallback((action: QuickAction) => {
    const run = async () => {
      try {
        setControlError(null);
        setControlNotice(null);
        await action.run();
        if (action.successMessage) {
          setControlNotice(action.successMessage);
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'Action cancelled') return;
        setControlNotice(null);
        setControlError(err instanceof Error ? err.message : `Unable to complete ${action.label.toLowerCase()}`);
      }
    };

    if (action.confirm) {
      Alert.alert(action.confirm.title, action.confirm.message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action.confirm.confirmLabel ?? 'Confirm',
          style: action.variant === 'destructive' ? 'destructive' : 'default',
          onPress: run,
        },
      ]);
    } else {
      run();
    }
  }, []);

  const quickActions = useMemo<QuickAction[]>(() => {
    if (!summaryData) return [];

    return [
      {
        id: 'kill-switch',
        label: 'Kill Switch',
        variant: 'destructive',
        run: handleKillSwitch,
        confirm: {
          title: 'Trigger kill switch?',
          message: 'This immediately halts all trading activity and cancels outstanding orders.',
          confirmLabel: 'Trigger',
        },
        successMessage: 'Kill switch triggered.',
        loading: killLoading,
        disabled: !summaryData.quickActions.killSwitchAvailable,
      },
      {
        id: 'pause-all',
        label: 'Pause All',
        variant: 'secondary',
        run: handlePauseAll,
        confirm: {
          title: 'Pause all strategies?',
          message: 'New orders will not be placed until you resume manually.',
          confirmLabel: 'Pause',
        },
        successMessage: 'All strategies paused.',
        loading: pauseLoading,
        disabled: !summaryData.quickActions.pauseAllAvailable,
      },
      {
        id: 'resume-all',
        label: 'Resume All',
        variant: 'primary',
        run: handleResumeAll,
        confirm: {
          title: 'Resume all strategies?',
          message: 'Trading resumes using the last saved configuration.',
          confirmLabel: 'Resume',
        },
        successMessage: 'Strategies resumed.',
        loading: resumeLoading,
        disabled: false,
      },
    ];
  }, [handleKillSwitch, handlePauseAll, handleResumeAll, killLoading, pauseLoading, resumeLoading, summaryData]);

  const alertCounts = useMemo(() => {
    return activityEntries.reduce(
      (acc, entry) => {
        if (entry.severity === 'critical') acc.critical += 1;
        else if (entry.severity === 'warn') acc.warning += 1;
        else acc.info += 1;
        return acc;
      },
      { critical: 0, warning: 0, info: 0 }
    );
  }, [activityEntries]);

  const strategies = summaryData?.strategies ?? [];

  const handleStrategyAction = useCallback(
    (strategy: StrategyStatus) => {
      const intent = strategy.status === 'running' ? 'pause' : 'resume';
      const title = intent === 'pause' ? `Pause ${strategy.name}?` : `Resume ${strategy.name}?`;
      const message =
        intent === 'pause'
          ? 'This strategy will stop placing new orders. Existing positions remain open.'
          : 'This strategy will begin trading again using the existing configuration.';

      const run = async () => {
        try {
          setControlError(null);
          setControlNotice(null);
          setStrategyBusy(strategy.strategyId);
          const biometricSignature = await promptBiometric(
            intent === 'pause' ? `Confirm pause for ${strategy.name}` : `Confirm resume for ${strategy.name}`
          );
          await controlStrategy({
            strategyId: strategy.strategyId,
            action: intent === 'pause' ? 'pause' : 'resume',
            confirmToken: Crypto.randomUUID(),
            biometricSignature,
          }).unwrap();
          setControlNotice(`${strategy.name} ${intent === 'pause' ? 'paused' : 'resumed'}.`);
        } catch (err) {
          if (err instanceof Error && err.message === 'Action cancelled') return;
          setControlError(err instanceof Error ? err.message : 'Unable to update strategy.');
        } finally {
          setStrategyBusy(null);
        }
      };

      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: intent === 'pause' ? 'Pause' : 'Resume',
          style: intent === 'pause' ? 'destructive' : 'default',
          onPress: run,
        },
      ]);
    },
    [controlStrategy, promptBiometric]
  );

  const connectionStatusTone = websocketConnected ? 'positive' : 'warning';
  const connectionStatusLabel = websocketConnected ? 'Live connection' : 'Reconnecting…';
  const updatedLabel = formatRelativeTime(lastSyncedAt ?? summaryData?.portfolio.updatedAt);

  const netValue =
    summaryData?.portfolio.bankRollUsd !== undefined && summaryData?.portfolio.totalPnlUsd !== undefined
      ? summaryData.portfolio.bankRollUsd + summaryData.portfolio.totalPnlUsd
      : undefined;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing(2), gap: theme.spacing(2) }}
      refreshControl={<RefreshControl tintColor={theme.colors.accent} refreshing={isFetching} onRefresh={onRefresh} />}
    >
      <Surface variant="secondary" style={{ paddingVertical: theme.spacing(1.5) }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <StatusPill label={connectionStatusLabel} tone={connectionStatusTone} />
          <ThemedText variant="caption" muted>
            {updatedLabel}
          </ThemedText>
        </View>
      </Surface>

      <Surface>
        <ThemedText variant="headline" weight="bold">
          Portfolio Overview
        </ThemedText>
        {isInitialLoading ? (
          <View style={{ paddingVertical: theme.spacing(4), alignItems: 'center' }}>
            <ActivityIndicator color={theme.colors.accent} />
            <ThemedText variant="caption" muted style={{ marginTop: theme.spacing(1) }}>
              Loading latest performance…
            </ThemedText>
          </View>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: theme.spacing(1.5),
              marginTop: theme.spacing(2),
            }}
          >
            <Surface variant="secondary" style={{ flex: 1, minWidth: 160 }}>
              <ThemedText muted variant="caption">
                Net Portfolio Value
              </ThemedText>
              <ThemedText variant="title" weight="bold" style={{ marginTop: theme.spacing(0.5) }}>
                {formatCurrency(netValue)}
              </ThemedText>
              <StatusPill
                label={`Bankroll ${formatCurrency(summaryData?.portfolio.bankRollUsd)}`}
                tone="neutral"
                style={{ alignSelf: 'flex-start', marginTop: theme.spacing(1.25) }}
              />
            </Surface>

            <Surface variant="secondary" style={{ flex: 1, minWidth: 160 }}>
              <ThemedText muted variant="caption">
                Total P&L (All Time)
              </ThemedText>
              <ThemedText
                variant="title"
                weight="bold"
                style={{
                  marginTop: theme.spacing(0.5),
                  color:
                    (summaryData?.portfolio.totalPnlUsd ?? 0) >= 0 ? theme.colors.positive : theme.colors.negative,
                }}
              >
                {formatCurrency(summaryData?.portfolio.totalPnlUsd)}
              </ThemedText>
              <StatusPill
                label={`Today ${formatPercent(summaryData?.portfolio.dayChangePct)}`}
                tone={(summaryData?.portfolio.dayChangePct ?? 0) >= 0 ? 'positive' : 'negative'}
                style={{ alignSelf: 'flex-start', marginTop: theme.spacing(1.25) }}
              />
            </Surface>

            <Surface variant="secondary" style={{ flex: 1, minWidth: 160 }}>
              <ThemedText muted variant="caption">
                Active Strategies
              </ThemedText>
              <ThemedText variant="title" weight="bold" style={{ marginTop: theme.spacing(0.5) }}>
                {summaryData?.portfolio.activeStrategies ?? '--'}
              </ThemedText>
              <StatusPill
                label={`Guard ${summaryData ? guardCopy[summaryData.risk.guardState] : '—'}`}
                tone={summaryData ? guardToneMap[summaryData.risk.guardState] : 'neutral'}
                style={{ alignSelf: 'flex-start', marginTop: theme.spacing(1.25) }}
              />
            </Surface>
          </View>
        )}
      </Surface>

      <Surface>
        <ThemedText variant="title" weight="medium">
          Quick Actions
        </ThemedText>
        <View
          style={{
            flexDirection: 'row',
            gap: theme.spacing(1.5),
            marginTop: theme.spacing(2),
            flexWrap: 'wrap',
          }}
        >
          {quickActions.map((action) => (
            <PrimaryButton
              key={action.id}
              label={action.label}
              onPress={() => executeQuickAction(action)}
              variant={action.variant}
              loading={action.loading}
              disabled={action.disabled}
              style={{ flexGrow: 1, minWidth: 140 }}
            />
          ))}
        </View>
        {controlNotice ? (
          <ThemedText variant="caption" style={{ color: theme.colors.positive, marginTop: theme.spacing(1) }}>
            {controlNotice}
          </ThemedText>
        ) : null}
        {controlError ? (
          <ThemedText variant="caption" style={{ color: theme.colors.negative, marginTop: theme.spacing(1) }}>
            {controlError}
          </ThemedText>
        ) : null}
      </Surface>

      <Surface>
        <ThemedText variant="title" weight="medium">
          Risk &amp; Exposure
        </ThemedText>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing(1.5),
            marginTop: theme.spacing(2),
          }}
        >
          <Surface variant="secondary" style={{ flex: 1, minWidth: 150 }}>
            <ThemedText muted variant="caption">
              Guard State
            </ThemedText>
            <StatusPill
              label={summaryData ? guardCopy[summaryData.risk.guardState] : '—'}
              tone={summaryData ? guardToneMap[summaryData.risk.guardState] : 'neutral'}
              style={{ marginTop: theme.spacing(1) }}
            />
            <ThemedText variant="caption" muted style={{ marginTop: theme.spacing(1) }}>
              Automated safety checks running continuously.
            </ThemedText>
          </Surface>

          <Surface variant="secondary" style={{ flex: 1, minWidth: 150 }}>
            <ThemedText muted variant="caption">
              Global Drawdown
            </ThemedText>
            <ThemedText
              variant="title"
              weight="bold"
              style={{
                marginTop: theme.spacing(0.5),
                color:
                  (summaryData?.risk.globalDrawdownUsd ?? 0) > 0 ? theme.colors.negative : theme.colors.textPrimary,
              }}
            >
              {formatCurrency(summaryData?.risk.globalDrawdownUsd)}
            </ThemedText>
            <ThemedText variant="caption" muted style={{ marginTop: theme.spacing(1) }}>
              Company-wide drawdown threshold monitoring.
            </ThemedText>
          </Surface>

          <Surface variant="secondary" style={{ flex: 1, minWidth: 150 }}>
            <ThemedText muted variant="caption">
              Exposure
            </ThemedText>
            <ThemedText
              variant="title"
              weight="bold"
              style={{
                marginTop: theme.spacing(0.5),
                color:
                  (summaryData?.risk.exposurePct ?? 0) > 70 ? theme.colors.warning : theme.colors.textPrimary,
              }}
            >
              {formatPercent(summaryData?.risk.exposurePct)}
            </ThemedText>
            <ThemedText variant="caption" muted style={{ marginTop: theme.spacing(1) }}>
              Total capital deployed across active strategies.
            </ThemedText>
          </Surface>
        </View>
      </Surface>

      <Surface>
        <ThemedText variant="title" weight="medium">
          Alerts Snapshot
        </ThemedText>
        <View
          style={{
            flexDirection: 'row',
            gap: theme.spacing(1),
            marginTop: theme.spacing(1.5),
            flexWrap: 'wrap',
          }}
        >
          <StatusPill label={`${alertCounts.critical} Critical`} tone="negative" />
          <StatusPill label={`${alertCounts.warning} Warnings`} tone="warning" />
          <StatusPill label={`${alertCounts.info} Info`} tone="neutral" />
        </View>
        <ThemedText variant="caption" muted style={{ marginTop: theme.spacing(1.5) }}>
          Critical alerts include kill-switch triggers, margin calls, and risk breaches.
        </ThemedText>
      </Surface>

      <Surface>
        <ThemedText variant="title" weight="medium">
          Strategies
        </ThemedText>
        <View style={{ marginTop: theme.spacing(2), gap: theme.spacing(1.5) }}>
          {strategies.map((strategy) => {
            const statusTone =
              strategy.status === 'running' ? 'positive' : strategy.status === 'error' ? 'negative' : 'neutral';
            const intent = strategy.status === 'running' ? 'pause' : 'resume';

            return (
              <Surface key={strategy.strategyId} variant="secondary" style={{ padding: theme.spacing(1.5) }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    gap: theme.spacing(1.5),
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <ThemedText weight="bold">{strategy.name}</ThemedText>
                    <View style={{ flexDirection: 'row', gap: theme.spacing(1), marginTop: theme.spacing(0.75) }}>
                      <StatusPill label={strategy.status.toUpperCase()} tone={statusTone as any} />
                      <StatusPill
                        label={strategy.runMode === 'live' ? 'LIVE' : 'PAPER'}
                        tone={strategy.runMode === 'live' ? 'positive' : 'neutral'}
                      />
                    </View>
                  </View>
                  <PrimaryButton
                    label={intent === 'pause' ? 'Pause' : 'Resume'}
                    variant={intent === 'pause' ? 'secondary' : 'primary'}
                    onPress={() => handleStrategyAction(strategy)}
                    loading={strategyBusy === strategy.strategyId}
                    disabled={strategyBusy !== null && strategyBusy !== strategy.strategyId}
                    style={{ alignSelf: 'center', minWidth: 120 }}
                  />
                </View>
                <ThemedText variant="caption" muted style={{ marginTop: theme.spacing(1) }}>
                  Last run {formatRelativeTime(strategy.lastRunAt)} • PnL {formatPercent(strategy.pnlPct)}
                </ThemedText>
              </Surface>
            );
          })}
          {!strategies.length && !isInitialLoading ? (
            <ThemedText muted>You do not have any strategies assigned yet.</ThemedText>
          ) : null}
        </View>
      </Surface>

      <Surface>
        <ThemedText variant="title" weight="medium">
          Recent Activity
        </ThemedText>
        <View style={{ marginTop: theme.spacing(2), gap: theme.spacing(1.5) }}>
          {activityEntries.slice(0, 6).map((entry) => {
            const tone =
              entry.severity === 'critical'
                ? severityToneMap.critical
                : entry.severity === 'warn'
                ? severityToneMap.warn
                : severityToneMap.info;
            return (
              <Surface key={entry.id} variant="secondary" style={{ padding: theme.spacing(1.5) }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: theme.spacing(0.75),
                  }}
                >
                  <ThemedText weight="medium" style={{ flex: 1, marginRight: theme.spacing(1) }}>
                    {entry.title}
                  </ThemedText>
                  <StatusPill label={(entry.severity ?? 'info').toUpperCase()} tone={tone as any} />
                </View>
                <ThemedText variant="caption" muted>
                  {new Date(entry.createdAt).toLocaleString()}
                </ThemedText>
                {entry.description ? (
                  <ThemedText variant="body" muted style={{ marginTop: theme.spacing(0.5) }}>
                    {entry.description}
                  </ThemedText>
                ) : null}
              </Surface>
            );
          })}
          {!activityEntries.length && !isInitialLoading ? (
            <ThemedText muted>No recent activity.</ThemedText>
          ) : null}
        </View>
      </Surface>
    </ScrollView>
  );
};
