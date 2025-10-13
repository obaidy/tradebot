import { createSlice, PayloadAction } from '@reduxjs/toolkit';

type AuthStatus = 'checking' | 'authenticated' | 'signedOut' | 'error';

export interface UserProfile {
  id: string;
  email?: string;
  name?: string;
  roles: string[];
  clientIds: string[];
  plan?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface AuthState extends AuthTokens {
  status: AuthStatus;
  user?: UserProfile;
  deviceId?: string;
  error?: string;
}

const initialState: AuthState = {
  status: 'checking',
  accessToken: '',
  refreshToken: undefined,
  expiresAt: 0,
  user: undefined,
  deviceId: undefined,
  error: undefined,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    beginAuth(state) {
      state.status = 'checking';
      state.error = undefined;
    },
    setAuthenticated(
      state,
      action: PayloadAction<{ tokens: AuthTokens; user: UserProfile; deviceId: string }>
    ) {
      state.status = 'authenticated';
      state.accessToken = action.payload.tokens.accessToken;
      state.refreshToken = action.payload.tokens.refreshToken;
      state.expiresAt = action.payload.tokens.expiresAt;
      state.user = action.payload.user;
      state.deviceId = action.payload.deviceId;
      state.error = undefined;
    },
    updateAccessToken(state, action: PayloadAction<{ accessToken: string; expiresAt: number }>) {
      state.accessToken = action.payload.accessToken;
      state.expiresAt = action.payload.expiresAt;
    },
    setAuthError(state, action: PayloadAction<string>) {
      state.status = 'error';
      state.error = action.payload;
      state.accessToken = '';
      state.refreshToken = undefined;
      state.expiresAt = 0;
    },
    signOut() {
      return { ...initialState, status: 'signedOut' };
    },
  },
});

export const { beginAuth, setAuthenticated, setAuthError, signOut, updateAccessToken } = authSlice.actions;

export const selectAuthState = (state: { auth: AuthState }) => state.auth;
export const selectAccessToken = (state: { auth: AuthState }) => state.auth.accessToken;
export const selectAuthStatus = (state: { auth: AuthState }) => state.auth.status;
export const selectCurrentUser = (state: { auth: AuthState }) => state.auth.user;
export const selectDeviceId = (state: { auth: AuthState }) => state.auth.deviceId;
export const selectAuthError = (state: { auth: AuthState }) => state.auth.error;

export default authSlice.reducer;
