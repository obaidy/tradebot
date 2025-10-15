import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '@/theme';
import { Surface } from '@/components/Surface';
import { ThemedText } from '@/components/ThemedText';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Sparkline } from '@/components/Sparkline';
import { StatusPill } from '@/components/StatusPill';
import {
  useCreateMarketWatchlistMutation,
  useDeleteMarketWatchlistMutation,
  useGetMarketSnapshotsQuery,
  useGetMarketWatchlistsQuery,
  useUpdateMarketWatchlistMutation,
} from '@/services/api';
import type { MarketSnapshot, MarketWatchlist } from '@/services/types';
import { useAppSelector } from '@/hooks/store';
import { formatApiError } from '@/utils/error';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);

const formatPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const formatCompactUsd = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

type EditorState = {
  id?: string;
  name: string;
  symbols: string[];
};

export const MarketsScreen: React.FC = () => {
  const theme = useTheme();
  const networkStatus = useAppSelector((state) => state.app.networkStatus);

  const {
    data: snapshots,
    isFetching: fetchingSnapshots,
    refetch: refetchSnapshots,
    error: snapshotsError,
  } = useGetMarketSnapshotsQuery();

  const {
    data: watchlists,
    isFetching: fetchingWatchlists,
    refetch: refetchWatchlists,
    error: watchlistsError,
  } = useGetMarketWatchlistsQuery();

  const [createWatchlist, { isLoading: creating }] = useCreateMarketWatchlistMutation();
  const [updateWatchlist, { isLoading: updating }] = useUpdateMarketWatchlistMutation();
  const [deleteWatchlist] = useDeleteMarketWatchlistMutation();

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ message: string; tone: 'positive' | 'negative' } | null>(null);

  const refreshing = fetchingSnapshots || fetchingWatchlists;
  const snapshotsErrorMessage = snapshotsError ? formatApiError(snapshotsError, 'Unable to load markets.') : null;
  const watchlistsErrorMessage = watchlistsError ? formatApiError(watchlistsError, 'Unable to load watchlists.') : null;

  const snapshotMap = useMemo(() => {
    const map = new Map<string, MarketSnapshot>();
    (snapshots ?? []).forEach((snapshot) => {
      map.set(snapshot.symbol.toUpperCase(), snapshot);
    });
    return map;
  }, [snapshots]);

  const availableSymbols = useMemo(() => {
    const symbols = new Set<string>();
    (snapshots ?? []).forEach((snapshot) => symbols.add(snapshot.symbol.toUpperCase()));
    if (editor?.symbols) {
      editor.symbols.forEach((symbol) => symbols.add(symbol.toUpperCase()));
    }
    return Array.from(symbols);
  }, [editor, snapshots]);

  const onRefresh = useCallback(() => {
    refetchSnapshots();
    refetchWatchlists();
  }, [refetchSnapshots, refetchWatchlists]);

  const openCreate = () => {
    const defaultSymbols = (snapshots ?? []).slice(0, 3).map((snapshot) => snapshot.symbol.toUpperCase());
    setEditor({ id: undefined, name: 'New Watchlist', symbols: defaultSymbols });
    setEditorError(null);
    setSaveStatus(null);
  };

  const openEdit = (watchlist: MarketWatchlist) => {
    setEditor({ id: watchlist.id, name: watchlist.name, symbols: [...watchlist.symbols] });
    setEditorError(null);
    setSaveStatus(null);
  };

  const closeEditor = () => {
    setEditor(null);
    setEditorError(null);
  };

  const toggleSymbol = (symbol: string) => {
    if (!editor) return;
    const upper = symbol.toUpperCase();
    setEditor((prev) => {
      if (!prev) return prev;
      const exists = prev.symbols.includes(upper);
      return {
        ...prev,
        symbols: exists ? prev.symbols.filter((item) => item !== upper) : [...prev.symbols, upper],
      };
    });
  };

  const handleSaveWatchlist = async () => {
    if (!editor) return;
    const name = editor.name.trim();
    const symbols = Array.from(new Set(editor.symbols.map((symbol) => symbol.toUpperCase())));
    if (!name.length) {
      setEditorError('Watchlist name is required.');
      return;
    }
    if (!symbols.length) {
      setEditorError('Select at least one market.');
      return;
    }
    try {
      setEditorError(null);
      setSaveStatus(null);
      if (editor.id) {
        await updateWatchlist({ id: editor.id, payload: { name, symbols } }).unwrap();
      } else {
        await createWatchlist({ name, symbols }).unwrap();
      }
      setSaveStatus({ message: 'Watchlist saved.', tone: 'positive' });
      setEditor(null);
      await refetchWatchlists();
    } catch (err) {
      const message = formatApiError(err, 'Unable to save watchlist.');
      setEditorError(message);
      setSaveStatus({ message, tone: 'negative' });
    }
  };

  const handleDeleteWatchlist = (watchlist: MarketWatchlist) => {
    Alert.alert('Delete watchlist?', `Remove ${watchlist.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteWatchlist({ id: watchlist.id }).unwrap();
            await refetchWatchlists();
            setSaveStatus({ message: 'Watchlist deleted.', tone: 'positive' });
          } catch (err) {
            setSaveStatus({ message: formatApiError(err, 'Unable to delete watchlist.'), tone: 'negative' });
          }
        },
      },
    ]);
  };

  const saving = creating || updating;

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing(2), gap: theme.spacing(2) }}
        refreshControl={<RefreshControl tintColor={theme.colors.accent} refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Surface>
          <ThemedText variant="title" weight="medium">
            Market Movers
          </ThemedText>
          {snapshotsErrorMessage ? (
            <ThemedText variant="caption" style={{ color: theme.colors.negative, marginTop: theme.spacing(1) }}>
              {snapshotsErrorMessage}
            </ThemedText>
          ) : null}
          {networkStatus === 'offline' ? (
            <ThemedText variant="caption" style={{ color: theme.colors.warning, marginTop: theme.spacing(1) }}>
              Offline mode – showing cached quotes.
            </ThemedText>
          ) : null}
        </Surface>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(1.5) }}>
          {(snapshots ?? []).map((snapshot) => {
            const positive = snapshot.change24hPct >= 0;
            return (
              <Surface key={snapshot.symbol} variant="secondary" style={{ flexBasis: '48%', flexGrow: 1, gap: theme.spacing(1) }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <ThemedText weight="medium">{snapshot.symbol}</ThemedText>
                  <StatusPill
                    label={formatPercent(snapshot.change24hPct)}
                    tone={positive ? 'positive' : 'negative'}
                  />
                </View>
                <ThemedText variant="headline" weight="bold">
                  {formatCurrency(snapshot.price)}
                </ThemedText>
                <ThemedText variant="caption" muted>
                  24h Volume {formatCompactUsd(snapshot.volumeUsd24h)} • Spread {snapshot.spreadBps?.toFixed(2) ?? '—'} bps
                </ThemedText>
                {snapshot.sparkline ? (
                  <Sparkline data={snapshot.sparkline} color={positive ? theme.colors.positive : theme.colors.negative} height={48} />
                ) : null}
              </Surface>
            );
          })}
        </View>

        <Surface style={{ gap: theme.spacing(1.25) }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <ThemedText variant="title" weight="medium">
              Watchlists
            </ThemedText>
            <PrimaryButton label="Add" onPress={openCreate} variant="primary" />
          </View>
          {watchlistsErrorMessage ? (
            <ThemedText variant="caption" style={{ color: theme.colors.negative }}>
              {watchlistsErrorMessage}
            </ThemedText>
          ) : null}
          {saveStatus ? (
            <ThemedText
              variant="caption"
              style={{ color: saveStatus.tone === 'positive' ? theme.colors.positive : theme.colors.negative }}
            >
              {saveStatus.message}
            </ThemedText>
          ) : null}
          {networkStatus === 'offline' ? (
            <ThemedText variant="caption" style={{ color: theme.colors.warning }}>
              Changes will sync once connectivity is restored.
            </ThemedText>
          ) : null}
        </Surface>

        {(watchlists ?? []).map((watchlist) => (
          <Surface key={watchlist.id} variant="secondary" style={{ gap: theme.spacing(1.25) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <ThemedText weight="medium">{watchlist.name}</ThemedText>
                <ThemedText variant="caption" muted>
                  {watchlist.symbols.length} markets • Updated {new Date(watchlist.updatedAt).toLocaleString()}
                </ThemedText>
              </View>
              <View style={{ flexDirection: 'row', gap: theme.spacing(1) }}>
                <PrimaryButton
                  label="Edit"
                  variant="secondary"
                  onPress={() => openEdit(watchlist)}
                />
                <PrimaryButton
                  label="Delete"
                  variant="destructive"
                  onPress={() => handleDeleteWatchlist(watchlist)}
                />
              </View>
            </View>

            <View style={{ gap: theme.spacing(1) }}>
              {watchlist.symbols.map((symbol) => {
                const snapshot = snapshotMap.get(symbol.toUpperCase());
                const positive = (snapshot?.change24hPct ?? 0) >= 0;
                return (
                  <Surface key={`${watchlist.id}-${symbol}`} variant="primary" style={{ padding: theme.spacing(1.5), gap: theme.spacing(0.75) }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View>
                        <ThemedText weight="medium">{symbol}</ThemedText>
                        <ThemedText variant="caption" muted>
                          {snapshot ? `Spread ${snapshot.spreadBps?.toFixed(2) ?? '—'} bps` : 'No live snapshot available'}
                        </ThemedText>
                      </View>
                      <StatusPill
                        label={snapshot ? formatPercent(snapshot.change24hPct) : '--'}
                        tone={positive ? 'positive' : 'negative'}
                      />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: theme.spacing(1) }}>
                      <View style={{ flex: 1 }}>
                        <ThemedText variant="headline" weight="bold" style={{ color: positive ? theme.colors.positive : theme.colors.negative }}>
                          {snapshot ? formatCurrency(snapshot.price) : '--'}
                        </ThemedText>
                        <ThemedText variant="caption" muted>
                          {snapshot ? `Volume ${formatCompactUsd(snapshot.volumeUsd24h)}` : 'Volume unknown'}
                        </ThemedText>
                      </View>
                      {snapshot?.sparkline ? (
                        <View style={{ width: 96 }}>
                          <Sparkline data={snapshot.sparkline} color={positive ? theme.colors.positive : theme.colors.negative} height={48} />
                        </View>
                      ) : null}
                    </View>
                  </Surface>
                );
              })}
            </View>
          </Surface>
        ))}

        {!watchlists?.length && !watchlistsErrorMessage ? (
          <Surface variant="secondary">
            <ThemedText muted>No watchlists yet. Create one to track the markets you care about.</ThemedText>
          </Surface>
        ) : null}
      </ScrollView>

      <Modal visible={!!editor} animationType="slide" transparent onRequestClose={closeEditor}>
        <View
          style={{
            flex: 1,
            backgroundColor: theme.colors.overlay,
            justifyContent: 'center',
            padding: theme.spacing(2),
          }}
        >
          <Surface style={{ gap: theme.spacing(1.5) }}>
            <ThemedText variant="title" weight="medium">
              {editor?.id ? 'Edit Watchlist' : 'New Watchlist'}
            </ThemedText>
            <TextInput
              value={editor?.name ?? ''}
              onChangeText={(text) => setEditor((prev) => (prev ? { ...prev, name: text } : prev))}
              placeholder="Watchlist name"
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radii.md,
                paddingHorizontal: theme.spacing(1),
                paddingVertical: theme.spacing(1),
                color: theme.colors.textPrimary,
              }}
            />
            <View style={{ gap: theme.spacing(0.75) }}>
              <ThemedText variant="label" muted>
                Markets
              </ThemedText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(0.75) }}>
                {availableSymbols.map((symbol) => {
                  const selected = editor?.symbols.includes(symbol);
                  return (
                    <Pressable
                      key={`symbol-${symbol}`}
                      onPress={() => toggleSymbol(symbol)}
                      style={({ pressed }) => [
                        {
                          paddingVertical: theme.spacing(0.75),
                          paddingHorizontal: theme.spacing(1.5),
                          borderRadius: theme.radii.lg,
                          borderWidth: 1,
                          borderColor: selected ? theme.colors.accent : theme.colors.border,
                          backgroundColor: selected ? theme.colors.accentSoft : theme.colors.surfaceAlt,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <ThemedText weight={selected ? 'medium' : 'regular'}>{symbol}</ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {editorError ? (
              <ThemedText variant="caption" style={{ color: theme.colors.negative }}>
                {editorError}
              </ThemedText>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing(1) }}>
              <PrimaryButton label="Cancel" variant="secondary" onPress={closeEditor} style={{ flex: 1 }} />
              <PrimaryButton
                label={editor?.id ? 'Save' : 'Create'}
                onPress={handleSaveWatchlist}
                loading={saving}
                style={{ flex: 1 }}
              />
            </View>
          </Surface>
        </View>
      </Modal>
    </>
  );
};
