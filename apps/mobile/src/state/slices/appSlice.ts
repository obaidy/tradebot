import { PayloadAction, createSlice } from '@reduxjs/toolkit';

export interface AppState {
  networkStatus: 'online' | 'offline';
  lastSyncedAt?: string;
  websocketConnected: boolean;
}

const initialState: AppState = {
  networkStatus: 'online',
  lastSyncedAt: undefined,
  websocketConnected: false,
};

export const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setNetworkStatus(state, action: PayloadAction<AppState['networkStatus']>) {
      state.networkStatus = action.payload;
    },
    setLastSyncedAt(state, action: PayloadAction<string | undefined>) {
      state.lastSyncedAt = action.payload;
    },
    setWebsocketConnected(state, action: PayloadAction<boolean>) {
      state.websocketConnected = action.payload;
    },
  },
});

export const { setNetworkStatus, setLastSyncedAt, setWebsocketConnected } = appSlice.actions;

export default appSlice.reducer;
