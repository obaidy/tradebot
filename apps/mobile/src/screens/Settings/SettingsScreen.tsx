import React from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { useTheme, useThemeMode } from '@/theme';
import { Surface } from '@/components/Surface';
import { ThemedText } from '@/components/ThemedText';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAppDispatch, useAppSelector } from '@/hooks/store';
import { selectCurrentUser, signOut } from '@/state/slices/authSlice';
import { clearSession } from '@/services/sessionStorage';

export const SettingsScreen: React.FC = () => {
  const theme = useTheme();
  const { mode, toggleMode } = useThemeMode();
  const user = useAppSelector(selectCurrentUser);
  const dispatch = useAppDispatch();

  const handleSignOut = async () => {
    await clearSession();
    dispatch(signOut());
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing(2), gap: theme.spacing(2) }}
    >
      <Surface>
        <ThemedText variant="title" weight="medium">
          Account
        </ThemedText>
        <View style={{ marginTop: theme.spacing(1.5), gap: theme.spacing(0.5) }}>
          <ThemedText weight="medium">{user?.name ?? 'Unknown User'}</ThemedText>
          <ThemedText variant="body" muted>
            {user?.email ?? '—'}
          </ThemedText>
          <ThemedText variant="caption" muted>
            Plan: {user?.plan ?? 'starter'} • Clients: {user?.clientIds.join(', ') ?? 'default'}
          </ThemedText>
        </View>
        <PrimaryButton
          label="Sign out"
          variant="secondary"
          style={{ marginTop: theme.spacing(2) }}
          onPress={handleSignOut}
        />
      </Surface>

      <Surface>
        <ThemedText variant="title" weight="medium">
          Appearance
        </ThemedText>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: theme.spacing(1.5),
          }}
        >
          <View>
            <ThemedText weight="medium">Dark Mode</ThemedText>
            <ThemedText variant="caption" muted>
              Toggle between dark and light themes
            </ThemedText>
          </View>
          <Switch value={mode === 'dark'} onValueChange={toggleMode} />
        </View>
      </Surface>

      <Surface>
        <ThemedText variant="title" weight="medium">
          Diagnostics
        </ThemedText>
        <ThemedText variant="body" muted style={{ marginTop: theme.spacing(1) }}>
          WebSocket and sync instrumentation will appear here once the realtime prototype is connected.
        </ThemedText>
      </Surface>
    </ScrollView>
  );
};
