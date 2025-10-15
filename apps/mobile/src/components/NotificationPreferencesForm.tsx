import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Surface } from '@/components/Surface';
import { ThemedText } from '@/components/ThemedText';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useTheme } from '@/theme';
import type { NotificationChannelConfig, NotificationPreferences } from '@/services/types';

type ChannelType = NotificationChannelConfig['channel'];

const CHANNEL_LABELS: Record<ChannelType, string> = {
  push: 'Mobile Push',
  email: 'Email Alerts',
  slack: 'Slack Alerts',
};

const SEVERITY_OPTIONS: Array<{ value: NotificationChannelConfig['severityThreshold']; label: string }> = [
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'critical', label: 'Critical' },
];

const AVAILABLE_CHANNELS: ChannelType[] = ['push', 'email', 'slack'];

interface Props {
  preferences?: NotificationPreferences;
  saving: boolean;
  onSave: (next: NotificationPreferences) => Promise<void>;
  onReset?: () => void;
  error?: string | null;
}

function normalizePreferences(pref: NotificationPreferences): NotificationPreferences {
  return {
    ...pref,
    channels: [...pref.channels].sort((a, b) => a.channel.localeCompare(b.channel)),
  };
}

function formatTime(value: string | undefined): string {
  if (!value) return '';
  const [hours, minutes] = value.split(':');
  const safeHours = hours?.padStart(2, '0') ?? '00';
  const safeMinutes = minutes?.padStart(2, '0') ?? '00';
  return `${safeHours.slice(0, 2)}:${safeMinutes.slice(0, 2)}`;
}

function upsertChannel(
  channels: NotificationChannelConfig[],
  channel: ChannelType,
  updater: (current: NotificationChannelConfig) => NotificationChannelConfig
): NotificationChannelConfig[] {
  const next = [...channels];
  const idx = next.findIndex((item) => item.channel === channel);
  const base: NotificationChannelConfig =
    idx >= 0
      ? next[idx]
      : {
          channel,
          enabled: channel === 'push',
          severityThreshold: 'critical',
        };
  const updated = updater(base);
  if (idx >= 0) {
    next[idx] = updated;
  } else {
    next.push(updated);
  }
  return next;
}

export const NotificationPreferencesForm: React.FC<Props> = ({ preferences, saving, onSave, onReset, error }) => {
  const theme = useTheme();
  const [form, setForm] = useState<NotificationPreferences | null>(preferences ? normalizePreferences(preferences) : null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (preferences) {
      setForm(normalizePreferences(preferences));
    }
  }, [preferences]);

  const canonicalOriginal = useMemo(
    () => (preferences ? JSON.stringify(normalizePreferences(preferences)) : null),
    [preferences]
  );
  const canonicalCurrent = useMemo(() => (form ? JSON.stringify(normalizePreferences(form)) : null), [form]);

  const isDirty = canonicalOriginal !== canonicalCurrent;

  const handleChannelUpdate = (channel: ChannelType, updater: (current: NotificationChannelConfig) => NotificationChannelConfig) => {
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        channels: upsertChannel(prev.channels, channel, updater),
      };
    });
  };

  const handleQuietHoursToggle = (channel: ChannelType, enabled: boolean) => {
    handleChannelUpdate(channel, (current) => ({
      ...current,
      quietHours: enabled
        ? current.quietHours ?? { start: '22:00', end: '07:00', timezone: 'UTC' }
        : undefined,
    }));
  };

  const handleQuietHoursChange = (
    channel: ChannelType,
    field: 'start' | 'end' | 'timezone',
    value: string
  ) => {
    handleChannelUpdate(channel, (current) => ({
      ...current,
      quietHours: {
        start: field === 'start' ? formatTime(value) : formatTime(current.quietHours?.start),
        end: field === 'end' ? formatTime(value) : formatTime(current.quietHours?.end),
        timezone: field === 'timezone' ? value.trim() : current.quietHours?.timezone ?? 'UTC',
      },
    }));
  };

  const handleSave = async () => {
    if (!form || !isDirty || saving) return;
    setFeedback(null);
    try {
      await onSave(normalizePreferences(form));
      setFeedback('Preferences updated.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update preferences.';
      setFeedback(message);
    }
  };

  if (!form) {
    return (
      <Surface variant="secondary">
        <View style={{ alignItems: 'center', paddingVertical: theme.spacing(2) }}>
          <ActivityIndicator color={theme.colors.accent} />
          <ThemedText muted variant="caption" style={{ marginTop: theme.spacing(1) }}>
            Loading notification preferences…
          </ThemedText>
        </View>
      </Surface>
    );
  }

  return (
    <View style={{ gap: theme.spacing(1.5) }}>
      <Surface>
        <ThemedText variant="title" weight="medium">
          Notification Preferences
        </ThemedText>
        <ThemedText variant="body" muted style={{ marginTop: theme.spacing(1) }}>
          Configure delivery channels, severity thresholds, and quiet hours for non-critical alerts. Critical alerts are always sent.
        </ThemedText>
      </Surface>

      {AVAILABLE_CHANNELS.map((channel) => {
        const current =
          form.channels.find((item) => item.channel === channel) ??
          ({
            channel,
            enabled: channel === 'push',
            severityThreshold: 'critical',
          } as NotificationChannelConfig);
        const quietHoursEnabled = !!current.quietHours;
        return (
          <Surface key={channel} variant="secondary" style={{ gap: theme.spacing(1.25) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <ThemedText weight="medium">{CHANNEL_LABELS[channel]}</ThemedText>
                <ThemedText variant="caption" muted>
                  Minimum severity: {current.severityThreshold.toUpperCase()}
                </ThemedText>
              </View>
              <Switch
                value={current.enabled}
                onValueChange={(value) =>
                  handleChannelUpdate(channel, (prev) => ({
                    ...prev,
                    enabled: value,
                  }))
                }
              />
            </View>

            <View style={{ gap: theme.spacing(0.75) }}>
              <ThemedText variant="caption" muted>
                Severity threshold
              </ThemedText>
              <View style={{ flexDirection: 'row', gap: theme.spacing(0.75) }}>
                {SEVERITY_OPTIONS.map((option) => {
                  const active = option.value === current.severityThreshold;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() =>
                        handleChannelUpdate(channel, (prev) => ({
                          ...prev,
                          severityThreshold: option.value,
                        }))
                      }
                      style={({ pressed }) => [
                        {
                          paddingVertical: theme.spacing(0.75),
                          paddingHorizontal: theme.spacing(1.5),
                          borderRadius: theme.radii.lg,
                          borderWidth: 1,
                          borderColor: active ? theme.colors.accent : theme.colors.border,
                          backgroundColor: active ? theme.colors.accentSoft : theme.colors.surface,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <ThemedText weight={active ? 'medium' : 'regular'}>{option.label}</ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ gap: theme.spacing(0.75) }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <ThemedText variant="caption" muted>
                  Quiet hours
                </ThemedText>
                <Switch value={quietHoursEnabled} onValueChange={(value) => handleQuietHoursToggle(channel, value)} />
              </View>
              {quietHoursEnabled ? (
                <View style={{ flexDirection: 'row', gap: theme.spacing(1) }}>
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="label" muted>
                      Start
                    </ThemedText>
                    <TextInput
                      value={formatTime(current.quietHours?.start)}
                      onChangeText={(value) => handleQuietHoursChange(channel, 'start', value)}
                      inputMode="numeric"
                      placeholder="22:00"
                      style={{
                        marginTop: theme.spacing(0.5),
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderRadius: theme.radii.md,
                        paddingHorizontal: theme.spacing(1),
                        paddingVertical: theme.spacing(0.75),
                        color: theme.colors.textPrimary,
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="label" muted>
                      End
                    </ThemedText>
                    <TextInput
                      value={formatTime(current.quietHours?.end)}
                      onChangeText={(value) => handleQuietHoursChange(channel, 'end', value)}
                      inputMode="numeric"
                      placeholder="07:00"
                      style={{
                        marginTop: theme.spacing(0.5),
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderRadius: theme.radii.md,
                        paddingHorizontal: theme.spacing(1),
                        paddingVertical: theme.spacing(0.75),
                        color: theme.colors.textPrimary,
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="label" muted>
                      Timezone
                    </ThemedText>
                    <TextInput
                      value={current.quietHours?.timezone ?? ''}
                      onChangeText={(value) => handleQuietHoursChange(channel, 'timezone', value)}
                      autoCapitalize="characters"
                      placeholder="UTC"
                      style={{
                        marginTop: theme.spacing(0.5),
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderRadius: theme.radii.md,
                        paddingHorizontal: theme.spacing(1),
                        paddingVertical: theme.spacing(0.75),
                        color: theme.colors.textPrimary,
                      }}
                    />
                  </View>
                </View>
              ) : (
                <ThemedText variant="caption" muted>
                  Quiet hours disabled.
                </ThemedText>
              )}
            </View>
          </Surface>
        );
      })}

      <Surface variant="secondary" style={{ gap: theme.spacing(1) }}>
        {feedback ? (
          <ThemedText
            variant="caption"
            style={{ color: feedback.includes('updated') ? theme.colors.positive : theme.colors.negative }}
          >
            {feedback}
          </ThemedText>
        ) : null}
        {error ? (
          <ThemedText variant="caption" style={{ color: theme.colors.negative }}>
            {error}
          </ThemedText>
        ) : null}
        <View style={{ flexDirection: 'row', gap: theme.spacing(1) }}>
          <PrimaryButton
            label="Save Changes"
            onPress={handleSave}
            loading={saving}
            disabled={!isDirty || saving}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label="Reset"
            variant="secondary"
            onPress={() => {
              if (preferences) {
                setForm(normalizePreferences(preferences));
                setFeedback(null);
              }
              onReset?.();
            }}
            disabled={!isDirty || saving}
            style={{ flex: 1 }}
          />
        </View>
      </Surface>
    </View>
  );
};
