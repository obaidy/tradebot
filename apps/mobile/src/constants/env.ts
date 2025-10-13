import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? Constants.manifest?.extra ?? {}) as Record<string, unknown>;

export const API_BASE_URL = typeof extra.apiBaseUrl === 'string' ? (extra.apiBaseUrl as string) : 'http://localhost:9400/mobile';
export const WS_BASE_URL = typeof extra.websocketUrl === 'string' ? (extra.websocketUrl as string) : 'ws://localhost:9400/mobile/ws';
