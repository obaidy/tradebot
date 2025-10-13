import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { CONFIG } from '../config';
import { ClientsRepository } from '../db/clientsRepo';
import {
  MobileAuthRepository,
  MobileAuthChallengeRow,
  MobileDeviceSessionRow,
} from '../db/mobileAuthRepo';
import { signJwt, verifyJwt } from './jwt';
import {
  AuthenticatedContext,
  MobileAccessTokenPayload,
  MobileSessionResponse,
  MobileUserProfile,
} from './types';

const DEFAULT_SCOPE = 'openid profile email offline_access';

export interface StartPkceInput {
  codeChallenge: string;
  redirectUri: string;
  deviceId?: string;
  scope?: string;
}

export interface StartPkceResponse {
  state: string;
  authorizationUrl: string;
  expiresAt: number;
}

export interface ExchangeCodeInput {
  state: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  deviceId?: string;
}

export interface ExchangeResultMfa {
  mfaRequired: true;
  challengeId: string;
  methods: string[];
}

export type ExchangeCodeResult = MobileSessionResponse | ExchangeResultMfa;

export interface VerifyMfaInput {
  challengeId: string;
  otp: string;
  deviceId?: string;
}

export interface RefreshSessionInput {
  refreshToken: string;
}

export interface RefreshSessionResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface Auth0TokenSuccess {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  scope?: string;
  token_type: string;
}

interface Auth0MfaErrorPayload {
  error: string;
  error_description?: string;
  mfa_token?: string;
  amr?: string[];
  [key: string]: unknown;
}

interface Auth0UserInfo {
  sub: string;
  email?: string;
  name?: string;
  nickname?: string;
  given_name?: string;
  family_name?: string;
  [key: string]: unknown;
}

function normalizeRefreshToken(refreshToken: string): string {
  return refreshToken.trim();
}

function hashRefreshToken(refreshToken: string): string {
  return crypto.createHash('sha256').update(refreshToken).digest('hex');
}

function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

function assertNonEmpty(value: string | undefined | null, message: string): asserts value is string {
  if (!value || !value.length) {
    throw new Error(message);
  }
}

function sanitizeRedirectUri(redirectUri: string): string {
  try {
    // Allow custom schemes supported by WHATWG URL
    // eslint-disable-next-line no-new
    new URL(redirectUri);
    return redirectUri;
  } catch (err) {
    throw new Error('invalid_redirect_uri');
  }
}

function resolveRoles(userInfo: Auth0UserInfo): string[] {
  const claims = [
    userInfo['https://tradebot.app/roles'],
    userInfo['https://tradebot.tradebot/roles'],
    userInfo.roles,
  ];
  for (const claim of claims) {
    if (Array.isArray(claim) && claim.length) {
      return claim.map((value) => String(value));
    }
  }
  return ['user'];
}

function resolveName(userInfo: Auth0UserInfo): string | null {
  if (typeof userInfo.name === 'string' && userInfo.name.length) {
    return userInfo.name;
  }
  if (typeof userInfo.nickname === 'string' && userInfo.nickname.length) {
    return userInfo.nickname;
  }
  return null;
}

function buildUserProfile(params: {
  userId: string;
  email?: string | null;
  name?: string | null;
  roles: string[];
  plan?: string | null;
  clientIds: string[];
}): MobileUserProfile {
  return {
    id: params.userId,
    email: params.email ?? undefined,
    name: params.name ?? undefined,
    roles: params.roles,
    clientIds: params.clientIds,
    plan: params.plan ?? undefined,
  };
}

export class MobileAuthService {
  private readonly issuer: string;

  private readonly clientId: string;

  private readonly audience: string | null;

  private readonly jwtSecret: string;

  private readonly accessTokenTtlSeconds: number;

  private readonly refreshTokenTtlMs: number;

  constructor(
    private readonly repo: MobileAuthRepository,
    private readonly clientsRepo: ClientsRepository
  ) {
    assertNonEmpty(process.env.AUTH0_ISSUER_BASE_URL, 'AUTH0_ISSUER_BASE_URL missing');
    this.issuer = process.env.AUTH0_ISSUER_BASE_URL!.replace(/\/$/, '');
    this.clientId = CONFIG.MOBILE.AUTH_CLIENT_ID;
    assertNonEmpty(this.clientId, 'MOBILE_AUTH_CLIENT_ID missing');
    this.audience = CONFIG.MOBILE.AUTH_AUDIENCE?.length ? CONFIG.MOBILE.AUTH_AUDIENCE : null;
    this.jwtSecret = CONFIG.MOBILE.JWT_SECRET;
    assertNonEmpty(this.jwtSecret, 'MOBILE_JWT_SECRET missing');
    this.accessTokenTtlSeconds = Math.max(CONFIG.MOBILE.ACCESS_TOKEN_TTL_SECONDS, 60);
    this.refreshTokenTtlMs = Math.max(CONFIG.MOBILE.REFRESH_TOKEN_TTL_DAYS, 1) * 24 * 60 * 60 * 1000;
  }

  async startPkce(input: StartPkceInput): Promise<StartPkceResponse> {
    const redirectUri = sanitizeRedirectUri(input.redirectUri);
    this.assertRedirectAllowed(redirectUri);
    if (!input.codeChallenge || input.codeChallenge.length < 43) {
      throw new Error('invalid_code_challenge');
    }
    const state = crypto.randomUUID();
    await this.repo.createAuthState({
      state,
      codeChallenge: input.codeChallenge,
      redirectUri,
      deviceId: input.deviceId ?? null,
      metadata: { scope: input.scope ?? DEFAULT_SCOPE },
    });
    const authorizationUrl = this.buildAuthorizeUrl({
      codeChallenge: input.codeChallenge,
      redirectUri,
      state,
      scope: input.scope ?? DEFAULT_SCOPE,
    });
    return {
      state,
      authorizationUrl,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult> {
    const authState = await this.repo.getAuthState(input.state);
    if (!authState) {
      throw new Error('invalid_state');
    }
    if (authState.redirectUri !== input.redirectUri) {
      throw new Error('redirect_mismatch');
    }
    try {
      const tokenResponse = await this.requestToken({
        code: input.code,
        codeVerifier: input.codeVerifier,
        redirectUri: authState.redirectUri,
      });
      await this.repo.deleteAuthState(input.state);
      return this.buildSessionFromToken({
        token: tokenResponse,
        deviceId: input.deviceId ?? authState.deviceId ?? crypto.randomUUID(),
      });
    } catch (err) {
      const handled = await this.handlePotentialMfaError(err, {
        state: input.state,
        deviceId: input.deviceId ?? authState.deviceId ?? null,
      });
      if (handled) {
        await this.repo.deleteAuthState(input.state);
        return handled;
      }
      throw err;
    }
  }

  async verifyMfa(input: VerifyMfaInput): Promise<MobileSessionResponse> {
    const challenge = await this.repo.getChallenge(input.challengeId);
    if (!challenge) {
      throw new Error('unknown_mfa_challenge');
    }
    if (!input.otp || input.otp.length < 4) {
      throw new Error('invalid_mfa_code');
    }
    try {
      const tokenResponse = await this.completeMfaChallenge(challenge, input.otp);
      await this.repo.deleteChallenge(input.challengeId);
      return this.buildSessionFromToken({
        token: tokenResponse,
        deviceId: input.deviceId ?? challenge.deviceId ?? crypto.randomUUID(),
      });
    } catch (err) {
      throw err;
    }
  }

  async refreshSession(input: RefreshSessionInput): Promise<RefreshSessionResult> {
    const refreshToken = normalizeRefreshToken(input.refreshToken);
    if (!refreshToken.length) {
      throw new Error('invalid_refresh_token');
    }
    const hash = hashRefreshToken(refreshToken);
    const session = await this.repo.findByRefreshHash(hash);
    if (!session) {
      throw new Error('session_not_found');
    }
    if (Date.now() - session.createdAt.getTime() > this.refreshTokenTtlMs) {
      throw new Error('refresh_token_expired');
    }
    const nextRefreshToken = generateRefreshToken();
    const nextRefreshHash = hashRefreshToken(nextRefreshToken);
    const expiresAt = new Date(Date.now() + this.accessTokenTtlSeconds * 1000);
    await this.repo.updateSession({
      sessionId: session.sessionId,
      refreshTokenHash: nextRefreshHash,
      accessTokenExpiresAt: expiresAt,
      lastSeenAt: new Date(),
    });
    const accessToken = this.signAccessToken(session);
    return {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresAt: expiresAt.getTime(),
    };
  }

  verifyAccessToken(token: string): AuthenticatedContext {
    const payload = verifyJwt<MobileAccessTokenPayload>(token, this.jwtSecret);
    return {
      sessionId: payload.sessionId,
      deviceId: payload.deviceId,
      user: {
        id: payload.sub,
        email: payload.email ?? undefined,
        name: payload.name ?? undefined,
        roles: payload.roles,
        clientIds: payload.clientIds,
        plan: payload.plan ?? undefined,
      },
    };
  }

  async resolveSession(sessionId: string): Promise<MobileDeviceSessionRow | null> {
    return this.repo.getSession(sessionId);
  }

  private buildAuthorizeUrl(params: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    scope: string;
  }): string {
    const url = new URL(`${this.issuer}/authorize`);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', params.scope || DEFAULT_SCOPE);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', params.state);
    if (this.audience) {
      url.searchParams.set('audience', this.audience);
    }
    return url.toString();
  }

  private async handlePotentialMfaError(
    err: unknown,
    context: { state: string; deviceId: string | null }
  ): Promise<ExchangeResultMfa | null> {
    if (!(err instanceof Error)) {
      return null;
    }
    const axiosError = err as AxiosError<Auth0MfaErrorPayload>;
    if (axiosError.response?.data?.error !== 'mfa_required') {
      return null;
    }
    const mfaToken = axiosError.response.data?.mfa_token;
    if (!mfaToken) {
      throw new Error('mfa_token_missing');
    }
    const methodsClaim = axiosError.response.data?.amr;
    const methods = Array.isArray(methodsClaim) && methodsClaim.length ? methodsClaim : ['totp'];
    const challengeId = crypto.randomUUID();
    await this.repo.createChallenge({
      challengeId,
      mfaToken,
      state: context.state,
      deviceId: context.deviceId ?? null,
      methods,
    });
    return {
      mfaRequired: true,
      challengeId,
      methods,
    };
  }

  private async requestToken(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<Auth0TokenSuccess> {
    const payload = {
      grant_type: 'authorization_code',
      client_id: this.clientId,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
    };
    try {
      const response = await axios.post<Auth0TokenSuccess>(
        `${this.issuer}/oauth/token`,
        payload,
        { headers: { 'Content-Type': 'application/json' } }
      );
      return response.data;
    } catch (err) {
      throw err;
    }
  }

  private async completeMfaChallenge(
    challenge: MobileAuthChallengeRow,
    otp: string
  ): Promise<Auth0TokenSuccess> {
    const payload = {
      grant_type: 'http://auth0.com/oauth/grant-type/mfa-otp',
      client_id: this.clientId,
      mfa_token: challenge.mfaToken,
      otp,
    };
    try {
      const response = await axios.post<Auth0TokenSuccess>(
        `${this.issuer}/oauth/token`,
        payload,
        { headers: { 'Content-Type': 'application/json' } }
      );
      return response.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.data) {
        throw new Error('mfa_verification_failed');
      }
      throw err;
    }
  }

  private async buildSessionFromToken(params: {
    token: Auth0TokenSuccess;
    deviceId: string;
  }): Promise<MobileSessionResponse> {
    const userInfo = await this.fetchUserInfo(params.token.access_token);
    const roles = resolveRoles(userInfo);
    const name = resolveName(userInfo);
    const email = userInfo.email ?? null;
    const { clientIds, plan } = await this.resolveClientScope(userInfo.sub, email);
    const sessionId = crypto.randomUUID();
    const refreshToken = generateRefreshToken();
    const refreshHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + this.accessTokenTtlSeconds * 1000);
    await this.repo.createSession({
      sessionId,
      userId: userInfo.sub,
      userEmail: email,
      userName: name,
      plan,
      deviceId: params.deviceId,
      refreshTokenHash: refreshHash,
      accessTokenExpiresAt: expiresAt,
      roles,
      clientIds,
      metadata: {
        auth0Scope: params.token.scope ?? DEFAULT_SCOPE,
        issuedAt: new Date().toISOString(),
      },
    });
    const accessToken = signJwt(
      {
        sessionId,
        sub: userInfo.sub,
        email,
        name,
        roles,
        clientIds,
        deviceId: params.deviceId,
        plan,
      },
      this.jwtSecret,
      { expiresInSeconds: this.accessTokenTtlSeconds }
    );
    return {
      tokens: {
        accessToken,
        refreshToken,
        expiresAt: expiresAt.getTime(),
      },
      user: buildUserProfile({
        userId: userInfo.sub,
        email,
        name,
        roles,
        clientIds,
        plan,
      }),
      deviceId: params.deviceId,
    };
  }

  private async fetchUserInfo(accessToken: string): Promise<Auth0UserInfo> {
    const response = await axios.get<Auth0UserInfo>(`${this.issuer}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  }

  private async resolveClientScope(userId: string, email: string | null) {
    const identifiers = [userId];
    if (email) {
      identifiers.push(email);
      identifiers.push(email.toLowerCase());
    }
    const clientRows = await this.clientsRepo.listByOwners(identifiers);
    if (!clientRows.length) {
      const fallback = CONFIG.RUN.CLIENT_ID || 'default';
      return { clientIds: [fallback], plan: null as string | null };
    }
    const clientIds = Array.from(new Set(clientRows.map((row) => row.id)));
    const plan = clientRows[0]?.plan ?? null;
    return { clientIds, plan };
  }

  private signAccessToken(session: MobileDeviceSessionRow): string {
    return signJwt(
      {
        sessionId: session.sessionId,
        sub: session.userId,
        email: session.userEmail,
        name: session.userName,
        roles: session.roles,
        clientIds: session.clientIds,
        deviceId: session.deviceId,
        plan: session.plan,
      },
      this.jwtSecret,
      { expiresInSeconds: this.accessTokenTtlSeconds }
    );
  }

  private assertRedirectAllowed(redirectUri: string) {
    const { REDIRECT_SCHEMES, ALLOWED_REDIRECTS } = CONFIG.MOBILE;
    if (ALLOWED_REDIRECTS.length) {
      if (!ALLOWED_REDIRECTS.includes(redirectUri)) {
        throw new Error('redirect_not_allowed');
      }
      return;
    }
    try {
      const parsed = new URL(redirectUri);
      const scheme = parsed.protocol.replace(':', '');
      if (!REDIRECT_SCHEMES.includes(scheme)) {
        throw new Error('redirect_scheme_not_allowed');
      }
    } catch (err) {
      throw new Error('invalid_redirect_uri');
    }
  }
}
