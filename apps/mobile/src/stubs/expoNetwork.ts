export type NetworkStateType =
  | 'NONE'
  | 'UNKNOWN'
  | 'CELLULAR'
  | 'WIFI'
  | 'BLUETOOTH'
  | 'ETHERNET'
  | 'WIMAX'
  | 'VPN'
  | 'OTHER';

export interface NetworkState {
  type?: NetworkStateType;
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}

export interface Subscription {
  remove(): void;
}

export async function getNetworkStateAsync(): Promise<NetworkState> {
  return {
    type: 'UNKNOWN',
    isConnected: null,
    isInternetReachable: null,
  };
}

export function addNetworkStateListener(listener: (state: NetworkState) => void): Subscription {
  let cancelled = false;
  setTimeout(() => {
    if (!cancelled) {
      listener({ type: 'UNKNOWN', isConnected: null, isInternetReachable: null });
    }
  }, 0);
  return {
    remove() {
      cancelled = true;
    },
  };
}

export function useNetworkState(): NetworkState {
  return { type: 'UNKNOWN', isConnected: null, isInternetReachable: null };
}

export const NetworkStateType = {
  NONE: 'NONE',
  UNKNOWN: 'UNKNOWN',
  CELLULAR: 'CELLULAR',
  WIFI: 'WIFI',
  BLUETOOTH: 'BLUETOOTH',
  ETHERNET: 'ETHERNET',
  WIMAX: 'WIMAX',
  VPN: 'VPN',
  OTHER: 'OTHER',
} as const;

export default {
  getNetworkStateAsync,
  addNetworkStateListener,
  useNetworkState,
  NetworkStateType,
};
