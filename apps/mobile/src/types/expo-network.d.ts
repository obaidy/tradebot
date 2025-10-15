declare module 'expo-network' {
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

  export function getNetworkStateAsync(): Promise<NetworkState>;
  export function addNetworkStateListener(listener: (state: NetworkState) => void): Subscription;
  export function useNetworkState(): NetworkState;
  export const NetworkStateType: Record<string, NetworkStateType>;
  const _default: {
    getNetworkStateAsync: typeof getNetworkStateAsync;
    addNetworkStateListener: typeof addNetworkStateListener;
    useNetworkState: typeof useNetworkState;
    NetworkStateType: typeof NetworkStateType;
  };
  export default _default;
}
