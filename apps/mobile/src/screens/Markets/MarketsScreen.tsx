import React from 'react';
import { ScrollView, View } from 'react-native';
import { Surface } from '@/components/Surface';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/theme';

export const MarketsScreen: React.FC = () => {
  const theme = useTheme();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing(2), gap: theme.spacing(2) }}
    >
      <Surface>
        <ThemedText variant="title" weight="medium">
          Market Watchlists
        </ThemedText>
        <ThemedText variant="body" muted style={{ marginTop: theme.spacing(1.5) }}>
          Integrate lightweight charts and exchange status indicators in Phase 2. For now this placeholder
          documents the intended layout.
        </ThemedText>
      </Surface>
      <Surface variant="secondary">
        <ThemedText weight="medium">Next Steps</ThemedText>
        <View style={{ marginTop: theme.spacing(1), gap: theme.spacing(1) }}>
          <ThemedText variant="body" muted>
            • Connect to metrics snapshot endpoint for BTC/ETH price and spread data.
          </ThemedText>
          <ThemedText variant="body" muted>
            • Embed TradingView lightweight chart via WebView or native module once dependencies are ready.
          </ThemedText>
          <ThemedText variant="body" muted>
            • Add watchlist management backed by `/v1/markets/watchlists` (to be implemented).
          </ThemedText>
        </View>
      </Surface>
    </ScrollView>
  );
};
