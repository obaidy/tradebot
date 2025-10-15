import { useEffect } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useAppDispatch } from '@/hooks/store';
import { setNetworkStatus } from '@/state/slices/appSlice';

export function useNetworkMonitor() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isOnline = state.isConnected && state.isInternetReachable !== false;
      dispatch(setNetworkStatus(isOnline ? 'online' : 'offline'));
    });
    return () => unsubscribe();
  }, [dispatch]);
}
