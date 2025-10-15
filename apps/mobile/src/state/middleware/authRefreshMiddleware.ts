import { Middleware } from '@reduxjs/toolkit';
import { refreshSession } from '@/services/authClient';
import { clearSession, saveSession } from '@/services/sessionStorage';
import {
  AuthState,
  setAuthError,
  setAuthenticated,
  signOut,
  updateAccessToken,
} from '@/state/slices/authSlice';

const REFRESH_BUFFER_MS = 60_000;
const MIN_REFRESH_INTERVAL_MS = 15_000;

let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
let inFlightRefresh: Promise<void> | null = null;

function clearRefreshTimer() {
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }
}

function persistSessionState(state: AuthState) {
  if (!state.user || !state.deviceId) return;
  saveSession({
    tokens: {
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      expiresAt: state.expiresAt,
    },
    user: state.user,
    deviceId: state.deviceId,
    pushToken: state.pushToken,
  }).catch(() => undefined);
}

function scheduleRefresh(state: AuthState, dispatch: (action: any) => void) {
  clearRefreshTimer();
  if (!state.refreshToken || !state.expiresAt) {
    return;
  }

  const now = Date.now();
  const msUntilExpiry = Math.max(state.expiresAt - now, 0);
  const timeout = Math.max(msUntilExpiry - REFRESH_BUFFER_MS, MIN_REFRESH_INTERVAL_MS);

  refreshTimeout = setTimeout(() => {
    if (inFlightRefresh) {
      return;
    }
    inFlightRefresh = (async () => {
      try {
        const tokens = await refreshSession({ refreshToken: state.refreshToken! });
        dispatch(
          updateAccessToken({
            accessToken: tokens.accessToken,
            expiresAt: tokens.expiresAt,
            refreshToken: tokens.refreshToken ?? state.refreshToken!,
          })
        );
      } catch (err) {
        dispatch(setAuthError('Session expired. Please sign in again.'));
        dispatch(signOut());
      } finally {
        inFlightRefresh = null;
      }
    })();
  }, timeout);
}

export const authRefreshMiddleware: Middleware = (storeApi) => (next) => (action) => {
  const result = next(action);
  const state = storeApi.getState() as { auth: AuthState };

  if (setAuthenticated.match(action) || updateAccessToken.match(action)) {
    persistSessionState(state.auth);
    scheduleRefresh(state.auth, storeApi.dispatch);
  } else if (signOut.match(action) || setAuthError.match(action)) {
    clearRefreshTimer();
    inFlightRefresh = null;
    clearSession().catch(() => undefined);
  }

  return result;
};

export function hydrateRefreshTimer(state: AuthState, dispatch: (action: any) => void) {
  if (!state.refreshToken || !state.expiresAt) {
    return;
  }
  const now = Date.now();
  if (state.expiresAt <= now) {
    dispatch(setAuthError('Session expired. Please sign in again.'));
    dispatch(signOut());
    return;
  }
  const msUntilExpiry = Math.max(state.expiresAt - now, 0);
  if (msUntilExpiry > REFRESH_BUFFER_MS) {
    scheduleRefresh(state, dispatch);
  } else if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const tokens = await refreshSession({ refreshToken: state.refreshToken! });
        dispatch(
          updateAccessToken({
            accessToken: tokens.accessToken,
            expiresAt: tokens.expiresAt,
            refreshToken: tokens.refreshToken ?? state.refreshToken!,
          })
        );
      } catch (err) {
        dispatch(setAuthError('Session expired. Please sign in again.'));
        dispatch(signOut());
      } finally {
        inFlightRefresh = null;
      }
    })();
  }
}
