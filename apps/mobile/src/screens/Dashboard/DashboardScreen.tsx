import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { Surface } from '@/components/Surface';
import { ThemedText } from '@/components/ThemedText';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useTheme } from '@/theme';
import {
  useGetActivityFeedQuery,
  useGetDashboardSummaryQuery,
  useTriggerKillSwitchMutation,
  usePauseAllControlsMutation,
  useResumeAllControlsMutation,
} from '@/services/api';
import type { ActivityEntry, DashboardSummaryResponse } from '@/services/types';
import { loadActivitySnapshot, loadDashboardSnapshot } from '@/services/offlineCache';

type QuickAction = {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  onPress: () => void;
  loading?: boolean;
};

export const DashboardScreen: React.FC = () => {
  const theme = useTheme();
  const { data: summary, isLoading, refetch, isFetching } = useGetDashboardSummaryQuery();
  const { data: activity } = useGetActivityFeedQuery({ cursor: undefined });
  const [triggerKillSwitch, { isLoading: killLoading }] = useTriggerKillSwitchMutation();
  const [pauseAllControls, { isLoading: pauseLoading }] = usePauseAllControlsMutation();
  const [resumeAllControls, { isLoading: resumeLoading }] = useResumeAllControlsMutation();
  const [cachedSummary, setCachedSummary] = useState<DashboardSummaryResponse | null>(null);
  const [cachedActivity, setCachedActivity] = useState<ActivityEntry[]>([]);
  const [controlError, setControlError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardSnapshot().then((cached) => {
      if (cached?.snapshot) {
        setCachedSummary(cached.snapshot);
      }
    });
    loadActivitySnapshot().then((cached) => {
      if (cached?.entries) {
        setCachedActivity(cached.entries);
      }
    });
  }, []);

  const summaryData = summary ?? cachedSummary;
  const activityEntries = activity?.entries ?? cachedActivity;

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
    setControlError(null);
    const biometricSignature = await promptBiometric('Confirm Kill Switch');
    await triggerKillSwitch({
      reason: 'Triggered from mobile quick action',
      confirmToken: Crypto.randomUUID(),
      biometricSignature,
    }).unwrap();
  }, [promptBiometric, triggerKillSwitch]);

  const handlePauseAll = useCallback(async () => {
    setControlError(null);
    const biometricSignature = await promptBiometric('Pause all strategies');
    await pauseAllControls({
      confirmToken: Crypto.randomUUID(),
      biometricSignature,
    }).unwrap();
  }, [pauseAllControls, promptBiometric]);

  const handleResumeAll = useCallback(async () => {
    setControlError(null);
    const biometricSignature = await promptBiometric('Resume all strategies');
    await resumeAllControls({
      confirmToken: Crypto.randomUUID(),
      biometricSignature,
    }).unwrap();
  }, [promptBiometric, resumeAllControls]);

  const quickActions = useMemo<QuickAction[]>(() => {
    if (!summaryData) return [];

    return [
      {
        id: 'kill-switch',
        label: 'Kill Switch',
        variant: 'destructive',
        onPress: () =>
          handleKillSwitch().catch((error) => {
            if (error instanceof Error && error.message === 'Action cancelled') return;
            setControlError(error instanceof Error ? error.message : 'Unable to trigger kill switch');
          }),
        loading: killLoading,
      },
      {
        id: 'pause-all',
        label: 'Pause All',
        variant: 'secondary',
        onPress: () =>
          handlePauseAll().catch((error) => {
            if (error instanceof Error && error.message === 'Action cancelled') return;
            setControlError(error instanceof Error ? error.message : 'Unable to pause strategies');
          }),
        loading: pauseLoading,
      },
      {
        id: 'resume-all',
        label: 'Resume All',
        variant: 'primary',
        onPress: () =>
          handleResumeAll().catch((error) => {
            if (error instanceof Error && error.message === 'Action cancelled') return;
            setControlError(error instanceof Error ? error.message : 'Unable to resume strategies');
          }),
        loading: resumeLoading,
      },
    ];
  }, [handleKillSwitch, handlePauseAll, handleResumeAll, killLoading, pauseLoading, resumeLoading, summaryData]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing(2), gap: theme.spacing(2) }}
      refreshControl={<RefreshControl tintColor={theme.colors.accent} refreshing={isFetching} onRefresh={onRefresh} />}
    >
      <Surface>
        <ThemedText variant="headline" weight="bold">
          Portfolio Overview
        </ThemedText>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginTop: theme.spacing(2),
          }}
        >
          <View>
            <ThemedText muted variant="caption">
              Total P&L
            </ThemedText>
            <ThemedText variant="title" weight="bold">
              {summaryData ? `$${summaryData.portfolio.totalPnlUsd.toFixed(0)}` : '--'}
            </ThemedText>
          </View>
          <View>
            <ThemedText muted variant="caption">
              Today
            </ThemedText>
            <ThemedText
              variant="title"
              weight="bold"
              style={{ color: (summary?.portfolio.dayChangePct ?? 0) >= 0 ? theme.colors.positive : theme.colors.negative }}
            >
              {summaryData ? `${summaryData.portfolio.dayChangePct.toFixed(2)}%` : '--'}
            </ThemedText>
          </View>
          <View>
            <ThemedText muted variant="caption">
              Active Strategies
            </ThemedText>
            <ThemedText variant="title" weight="bold">
              {summaryData?.portfolio.activeStrategies ?? '--'}
            </ThemedText>
          </View>
        </View>
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
          }}
        >
          {quickActions.map((action) => (
            <PrimaryButton
              key={action.id}
              label={action.label}
              onPress={action.onPress}
              variant={action.variant}
              loading={action.loading}
              style={{ flex: 1 }}
            />
          ))}
        </View>
        {controlError ? (
          <ThemedText variant="caption" style={{ color: theme.colors.negative, marginTop: theme.spacing(1) }}>
            {controlError}
          </ThemedText>
        ) : null}
      </Surface>

      <Surface>
        <ThemedText variant="title" weight="medium">
          Recent Activity
        </ThemedText>
        <View style={{ marginTop: theme.spacing(2), gap: theme.spacing(1.5) }}>
          {activityEntries.slice(0, 5).map((entry) => (
            <Surface key={entry.id} variant="secondary" style={{ padding: theme.spacing(1.5) }}>
              <ThemedText weight="medium">{entry.title}</ThemedText>
              <ThemedText variant="caption" muted>
                {new Date(entry.createdAt).toLocaleString()}
              </ThemedText>
              {entry.description ? (
                <ThemedText variant="body" muted style={{ marginTop: theme.spacing(0.5) }}>
                  {entry.description}
                </ThemedText>
              ) : null}
            </Surface>
          ))}
          {!activityEntries.length && !isLoading ? (
            <ThemedText muted>No recent activity.</ThemedText>
          ) : null}
        </View>
      </Surface>
    </ScrollView>
  );
};
