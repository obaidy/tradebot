import React from 'react';
import { NavigationContainer, DefaultTheme, Theme as NavigationTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { DashboardScreen } from '@/screens/Dashboard/DashboardScreen';
import { StrategiesScreen } from '@/screens/Strategies/StrategiesScreen';
import { MarketsScreen } from '@/screens/Markets/MarketsScreen';
import { AlertsScreen } from '@/screens/Alerts/AlertsScreen';
import { SettingsScreen } from '@/screens/Settings/SettingsScreen';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';

export type RootStackParamList = {
  Tabs: undefined;
  StrategyDetail: { strategyId: string };
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

function TabNavigator() {
  const theme = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        tabBarIcon: ({ focused, color, size }) => {
          const map: Record<string, string> = {
            Dashboard: focused ? 'analytics' : 'analytics-outline',
            Strategies: focused ? 'options' : 'options-outline',
            Markets: focused ? 'pulse' : 'pulse-outline',
            Alerts: focused ? 'notifications' : 'notifications-outline',
            Settings: focused ? 'settings' : 'settings-outline',
          };
          const name = map[route.name] ?? 'ellipse';
          return <Ionicons name={name as any} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Strategies" component={StrategiesScreen} />
      <Tab.Screen name="Markets" component={MarketsScreen} />
      <Tab.Screen name="Alerts" component={AlertsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export const AppNavigator: React.FC = () => {
  const theme = useTheme();
  useRealtimeSync();

  const navigationTheme: NavigationTheme = {
    ...DefaultTheme,
    dark: theme.mode === 'dark',
    colors: {
      ...DefaultTheme.colors,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.textPrimary,
      border: theme.colors.border,
      primary: theme.colors.accent,
      notification: theme.colors.accent,
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator>
        <Stack.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
