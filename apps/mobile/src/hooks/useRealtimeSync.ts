import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAppDispatch, useAppSelector } from '@/hooks/store';
import { selectAccessToken } from '@/state/slices/authSlice';
import { setLastSyncedAt, setWebsocketConnected } from '@/state/slices/appSlice';
import { realtimeClient } from '@/services/realtimeClient';
import type { RealtimeEvent } from '@/services/realtimeClient';
import { tradebotApi } from '@/services/api';
import { saveActivitySnapshot, saveDashboardSnapshot } from '@/services/offlineCache';

const ACTIVITY_ARGS = { cursor: undefined } as const;

export function useRealtimeSync() {
  const accessToken = useAppSelector(selectAccessToken);
  const dispatch = useAppDispatch();
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appState.current = nextState;
      if (nextState === 'active') {
        realtimeClient.resume();
      } else {
        realtimeClient.pause();
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!accessToken) {
      realtimeClient.disconnect();
      return;
    }

    realtimeClient.connect(accessToken, {
      tokenProvider: () => accessToken,
    });

    const unsubscribeConnected = realtimeClient.on('connected', () => {
      dispatch(setWebsocketConnected(true));
    });

    const unsubscribeDisconnected = realtimeClient.on('disconnected', () => {
      dispatch(setWebsocketConnected(false));
    });

    const unsubscribeDashboard = realtimeClient.on('dashboard.update', async (event) => {
      const { payload } = event as Extract<RealtimeEvent, { type: 'dashboard.update' }>;
      dispatch(tradebotApi.util.upsertQueryData('getDashboardSummary', undefined, payload));
      dispatch(setLastSyncedAt(new Date().toISOString()));
      await saveDashboardSnapshot(payload);
    });

    const unsubscribeActivity = realtimeClient.on('activity.append', async (event) => {
      const { payload } = event as Extract<RealtimeEvent, { type: 'activity.append' }>;
      try {
        dispatch(
          tradebotApi.util.updateQueryData('getActivityFeed', ACTIVITY_ARGS, (draft) => {
            draft.entries = [...payload, ...(draft.entries ?? [])].slice(0, 50);
          })
        );
      } catch (err) {
        dispatch(
          tradebotApi.util.upsertQueryData('getActivityFeed', ACTIVITY_ARGS, {
            entries: payload,
            nextCursor: undefined,
          })
        );
      }
      await saveActivitySnapshot(payload);
    });

    return () => {
      unsubscribeConnected();
      unsubscribeDisconnected();
      unsubscribeDashboard();
      unsubscribeActivity();
    };
  }, [accessToken, dispatch]);

  useEffect(() => {
    if (accessToken) {
      realtimeClient.updateAccessToken(accessToken);
      if (appState.current === 'active') {
        realtimeClient.resume();
      }
    }
  }, [accessToken]);
}
