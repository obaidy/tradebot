import React, { useMemo } from 'react';
import { FlatList, View } from 'react-native';
import { useTheme } from '@/theme';
import { Surface } from '@/components/Surface';
import { ThemedText } from '@/components/ThemedText';
import { PrimaryButton } from '@/components/PrimaryButton';
import {
  useGetActivityFeedQuery,
  useGetNotificationPreferencesQuery,
  useUpdateNotificationPreferencesMutation,
} from '@/services/api';

export const AlertsScreen: React.FC = () => {
  const theme = useTheme();
  const { data: feed, isFetching, refetch } = useGetActivityFeedQuery({ cursor: undefined });
  const { data: preferences } = useGetNotificationPreferencesQuery();
  const [updatePreferences, { isLoading: saving }] = useUpdateNotificationPreferencesMutation();

  const criticalEntries = useMemo(() => feed?.entries.filter((entry) => entry.severity === 'critical') ?? [], [feed]);

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
        <Surface variant="secondary">
          <ThemedText variant="title" weight="medium">
            Notification Preferences
          </ThemedText>
          <ThemedText variant="body" muted style={{ marginTop: theme.spacing(1) }}>
            Critical alerts are always delivered. Adjust warning/info levels from the settings screen once the
            preference endpoint is wired.
          </ThemedText>
          <PrimaryButton
            style={{ marginTop: theme.spacing(1.5) }}
            label="View Preferences"
            variant="secondary"
            loading={saving}
            onPress={() => {
              if (!preferences) return;
              updatePreferences({
                ...preferences,
              }).catch(() => undefined);
            }}
          />
        </Surface>
      )}
      ListEmptyComponent={() => (
        <View style={{ padding: theme.spacing(4) }}>
          <ThemedText muted>No critical alerts yet.</ThemedText>
        </View>
      )}
    />
  );
};
