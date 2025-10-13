import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActivityEntry, DashboardSummaryResponse } from '@/services/types';

const DASHBOARD_CACHE_KEY = 'tradebot/cache/dashboard';
const ACTIVITY_CACHE_KEY = 'tradebot/cache/activity';

export async function saveDashboardSnapshot(snapshot: DashboardSummaryResponse) {
  const payload = JSON.stringify({ snapshot, cachedAt: Date.now() });
  await AsyncStorage.setItem(DASHBOARD_CACHE_KEY, payload);
}

export interface CachedDashboard {
  snapshot: DashboardSummaryResponse;
  cachedAt: number;
}

export async function loadDashboardSnapshot(): Promise<CachedDashboard | null> {
  const raw = await AsyncStorage.getItem(DASHBOARD_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedDashboard;
  } catch (err) {
    await AsyncStorage.removeItem(DASHBOARD_CACHE_KEY);
    return null;
  }
}

export async function saveActivitySnapshot(entries: ActivityEntry[]) {
  const payload = JSON.stringify({ entries, cachedAt: Date.now() });
  await AsyncStorage.setItem(ACTIVITY_CACHE_KEY, payload);
}

export interface CachedActivity {
  entries: ActivityEntry[];
  cachedAt: number;
}

export async function loadActivitySnapshot(): Promise<CachedActivity | null> {
  const raw = await AsyncStorage.getItem(ACTIVITY_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedActivity;
  } catch (err) {
    await AsyncStorage.removeItem(ACTIVITY_CACHE_KEY);
    return null;
  }
}
