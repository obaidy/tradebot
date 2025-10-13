import { API_BASE_URL } from '@/constants/env';
import type { AuthTokens, UserProfile } from '@/state/slices/authSlice';
import type { PersistedSession } from './sessionStorage';
import type { DeviceRegistrationPayload } from './types';

interface StartPkceResponse {
  state: string;
  authorizationUrl: string;
  expiresAt: number;
}

interface SessionExchangePayload {
  tokens: AuthTokens;
  user: UserProfile;
  deviceId: string;
}

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface MfaChallengePayload {
  mfaRequired: true;
  challengeId: string;
  methods?: string[];
}

type ExchangePayload = SessionExchangePayload | MfaChallengePayload;

export type SessionExchangeResult =
  | { type: 'session'; session: PersistedSession }
  | { type: 'mfa'; challengeId: string; methods: string[] };

async function postJson<T>(
  path: string,
  body: unknown,
  options: { token?: string; method?: 'POST' | 'PUT' | 'PATCH' } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(`${API_BASE_URL}/${path}`, {
    method: options.method ?? 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
}

function mapSession(payload: SessionExchangePayload): PersistedSession {
  return {
    tokens: {
      accessToken: payload.tokens.accessToken,
      refreshToken: payload.tokens.refreshToken,
      expiresAt: payload.tokens.expiresAt,
    },
    user: payload.user,
    deviceId: payload.deviceId,
  };
}

export async function beginPkceSignIn(params: {
  codeChallenge: string;
  redirectUri: string;
  deviceId: string;
  scope?: string;
}): Promise<StartPkceResponse> {
  const response = await postJson<StartPkceResponse>('v1/auth/pkce/start', {
    codeChallenge: params.codeChallenge,
    redirectUri: params.redirectUri,
    deviceId: params.deviceId,
    scope: params.scope,
  });
  return response;
}

export async function exchangeCodeForSession(params: {
  state: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  deviceId: string;
}): Promise<SessionExchangeResult> {
  const response = await postJson<ExchangePayload>('v1/auth/exchange', {
    state: params.state,
    code: params.code,
    codeVerifier: params.codeVerifier,
    redirectUri: params.redirectUri,
    deviceId: params.deviceId,
  });

  if ((response as MfaChallengePayload).mfaRequired) {
    const challenge = response as MfaChallengePayload;
    return {
      type: 'mfa',
      challengeId: challenge.challengeId,
      methods: (challenge.methods ?? ['totp']).map((method) => method.toLowerCase()),
    };
  }

  return {
    type: 'session',
    session: mapSession(response as SessionExchangePayload),
  };
}

export async function verifyMfaChallenge(params: {
  challengeId: string;
  otp: string;
  deviceId: string;
}): Promise<PersistedSession> {
  const response = await postJson<SessionExchangePayload>('v1/auth/mfa/verify', {
    challengeId: params.challengeId,
    otp: params.otp,
    deviceId: params.deviceId,
  });
  return mapSession(response);
}

export async function refreshSession(params: { refreshToken: string }): Promise<AuthTokens> {
  const response = await postJson<RefreshResponse>('v1/auth/refresh', {
    refreshToken: params.refreshToken,
  });
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt: response.expiresAt,
  };
}

export async function registerDevice(
  payload: DeviceRegistrationPayload,
  accessToken: string
): Promise<void> {
  try {
    await postJson(
      'v1/devices/register',
      {
        deviceId: payload.deviceId,
        pushToken: payload.pushToken,
        platform: payload.platform,
        appVersion: payload.appVersion,
      },
      {
        token: accessToken,
      }
    );
  } catch (err) {
    console.warn('device_registration_failed', err);
  }
}
