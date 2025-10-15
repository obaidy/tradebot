import { useEffect } from 'react';
import { API_BASE_URL } from '@/constants/env';
import { useAppDispatch } from '@/hooks/store';
import { setNetworkStatus } from '@/state/slices/appSlice';

export function useNetworkMonitor() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    let fallbackInterval: ReturnType<typeof setInterval> | undefined;

    const emit = (isOnline: boolean) => {
      dispatch(setNetworkStatus(isOnline ? 'online' : 'offline'));
    };

    const runFallbackCheck = async () => {
      const targets = [
        `${API_BASE_URL.replace(/\/$/, '')}/health`,
        'https://www.gstatic.com/generate_204',
      ];
      for (const url of targets) {
        try {
          const response = await fetch(url, {
            method: 'HEAD',
            cache: 'no-cache',
          });
          if (response.ok) {
            emit(true);
            return;
          }
        } catch {
          // try next endpoint
        }
      }
      emit(false);
    };

    const startFallback = () => {
      if (fallbackInterval) return;
      runFallbackCheck().catch(() => emit(false));
      fallbackInterval = setInterval(() => {
        runFallbackCheck().catch(() => emit(false));
      }, 15000);
    };

    startFallback();

    return () => {
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    };
  }, [dispatch]);
}
