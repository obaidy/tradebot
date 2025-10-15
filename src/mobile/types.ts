export interface MobileUserProfile {
  id: string;
  email?: string | null;
  name?: string | null;
  roles: string[];
  clientIds: string[];
  plan?: string | null;
}

export interface MobileAccessTokenPayload {
  sessionId: string;
  sub: string;
  email?: string | null;
  name?: string | null;
  roles: string[];
  clientIds: string[];
  deviceId: string;
  plan?: string | null;
  iat: number;
  exp: number;
}

export interface MobileSessionResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
  user: MobileUserProfile;
  deviceId: string;
}

export interface AuthenticatedContext {
  sessionId: string;
  deviceId: string;
  user: MobileUserProfile;
}

export interface ControlNotificationPayload {
  clientId: string;
  action: 'kill-switch' | 'pause-all' | 'resume-all' | 'strategy-pause' | 'strategy-resume' | 'account-delete';
  actor: string;
  deviceId: string;
  strategyId?: string;
  metadata?: Record<string, unknown>;
}
