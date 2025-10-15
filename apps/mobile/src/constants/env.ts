import Constants from 'expo-constants';

const rawExtra = ((Constants.expoConfig as any)?.extra ?? (Constants.manifest as any)?.extra ?? {}) as Record<string, unknown>;
const extra: Record<string, unknown> = rawExtra;

export const API_BASE_URL = typeof extra.apiBaseUrl === 'string' ? (extra.apiBaseUrl as string) : 'http://localhost:9400/mobile';
export const WS_BASE_URL = typeof extra.websocketUrl === 'string' ? (extra.websocketUrl as string) : 'ws://localhost:9400/mobile/ws';

if (__DEV__) {
  // Helps confirm we are pointing at the expected backend when debugging.
  console.log('[mobile-config] API_BASE_URL', API_BASE_URL);
  console.log('[mobile-config] WS_BASE_URL', WS_BASE_URL);
}
