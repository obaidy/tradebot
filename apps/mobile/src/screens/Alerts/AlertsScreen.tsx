import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useTheme } from '@/theme';
import { Surface } from '@/components/Surface';
import { ThemedText } from '@/components/ThemedText';
import { NotificationPreferencesForm } from '@/components/NotificationPreferencesForm';
import {
  useGetActivityFeedQuery,
  useGetNotificationPreferencesQuery,
  useUpdateNotificationPreferencesMutation,
} from '@/services/api';
import type { NotificationPreferences } from '@/services/types';
import { formatApiError } from '@/utils/error';

export const AlertsScreen: React.FC = () => {
  const theme = useTheme();
  const { data: feed, isFetching, refetch } = useGetActivityFeedQuery({ cursor: undefined });
  const {
    data: preferences,
    error: preferencesError,
    refetch: refetchPreferences,
  } = useGetNotificationPreferencesQuery();
  const [updatePreferences, { isLoading: saving }] = useUpdateNotificationPreferencesMutation();
  const [saveError, setSaveError] = useState<string | null>(null);

  const criticalEntries = useMemo(() => feed?.entries.filter((entry) => entry.severity === 'critical') ?? [], [feed]);
  const queryErrorMessage = preferencesError ? formatApiError(preferencesError) : null;

  const handleSave = async (next: NotificationPreferences) => {
    setSaveError(null);
    try {
      await updatePreferences(next).unwrap();
      await refetchPreferences();
    } catch (err) {
      const message = formatApiError(err);
      setSaveError(message);
      throw new Error(message);
    }
  };

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing(2), gap: theme.spacing(2) }}
      data={criticalEntries}
      keyExtractor={(item) => item.id}
      refreshing={isFetching}
      onRefresh={refetch}
      renderItem={({ item }) => (
        <Surface>
          <ThemedText weight="medium">{item.title}</ThemedText>
          <ThemedText variant="body" muted style={{ marginTop: theme.spacing(0.5) }}>
            {item.description}
          </ThemedText>
          <ThemedText variant="caption" muted style={{ marginTop: theme.spacing(0.5) }}>
            {new Date(item.createdAt).toLocaleString()}
          </ThemedText>
        </Surface>
      )}
      ListHeaderComponent={() => (
        <NotificationPreferencesForm
          preferences={preferences}
          saving={saving}
          onSave={handleSave}
          onReset={() => refetchPreferences()}
          error={queryErrorMessage ?? saveError}
        />
      )}
      ListEmptyComponent={() => (
        <View style={{ padding: theme.spacing(4) }}>
          <ThemedText muted>No critical alerts yet.</ThemedText>
        </View>
      )}
    />
  );
};
