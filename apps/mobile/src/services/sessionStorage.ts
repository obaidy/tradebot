import * as SecureStore from 'expo-secure-store';
import type { AuthTokens, UserProfile } from '@/state/slices/authSlice';

const SESSION_KEY = 'tradebot_mobile_session';

export interface PersistedSession {
  tokens: AuthTokens;
  user: UserProfile;
  deviceId: string;
  pushToken?: string;
}

export async function saveSession(session: PersistedSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function loadSession(): Promise<PersistedSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedSession;
  } catch (err) {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

export async function updatePersistedSessionTokens(tokens: AuthTokens) {
  const existing = await loadSession();
  if (!existing) return;
  await saveSession({
    ...existing,
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? existing.tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    },
  });
}
