import { Pool } from 'pg';

export interface MobileAuthStateRow {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  deviceId: string | null;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
}

export interface MobileAuthChallengeRow {
  challengeId: string;
  mfaToken: string;
  state: string;
  deviceId: string | null;
  createdAt: Date;
  methods: string[];
}

export interface MobileDeviceSessionRow {
  sessionId: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  plan: string | null;
  deviceId: string;
  refreshTokenHash: string;
  accessTokenExpiresAt: Date;
  roles: string[];
  clientIds: string[];
  platform: string | null;
  pushToken: string | null;
  metadata: Record<string, unknown> | null;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface CreateAuthStateInput {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  deviceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateAuthChallengeInput {
  challengeId: string;
  mfaToken: string;
  state: string;
  deviceId?: string | null;
  methods?: string[];
}

export interface CreateSessionInput {
  sessionId: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  plan: string | null;
  deviceId: string;
  refreshTokenHash: string;
  accessTokenExpiresAt: Date;
  roles: string[];
  clientIds: string[];
  platform?: string | null;
  pushToken?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateSessionInput {
  sessionId: string;
  refreshTokenHash?: string;
  accessTokenExpiresAt?: Date;
  pushToken?: string | null;
  platform?: string | null;
  metadata?: Record<string, unknown> | null;
  lastSeenAt?: Date;
}

export class MobileAuthRepository {
  constructor(private readonly pool: Pool) {}

  private mapAuthState(row: any): MobileAuthStateRow {
    return {
      state: row.state,
      codeChallenge: row.code_challenge,
      redirectUri: row.redirect_uri,
      deviceId: row.device_id ?? null,
      createdAt: row.created_at,
      metadata: row.metadata ?? null,
    };
  }

  private mapChallenge(row: any): MobileAuthChallengeRow {
    return {
      challengeId: row.challenge_id,
      mfaToken: row.mfa_token,
      state: row.state,
      deviceId: row.device_id ?? null,
      createdAt: row.created_at,
      methods: Array.isArray(row.methods) ? (row.methods as string[]) : [],
    };
  }

  private mapSession(row: any): MobileDeviceSessionRow {
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      userEmail: row.user_email ?? null,
      userName: row.user_name ?? null,
      plan: row.plan ?? null,
      deviceId: row.device_id,
      refreshTokenHash: row.refresh_token_hash,
      accessTokenExpiresAt: row.access_token_expires_at,
      roles: Array.isArray(row.roles) ? (row.roles as string[]) : [],
      clientIds: Array.isArray(row.client_ids) ? (row.client_ids as string[]) : [],
      platform: row.platform ?? null,
      pushToken: row.push_token ?? null,
      metadata: row.metadata ?? null,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
    };
  }

  async createAuthState(input: CreateAuthStateInput): Promise<MobileAuthStateRow> {
    const res = await this.pool.query(
      `INSERT INTO mobile_auth_states (state, code_challenge, redirect_uri, device_id, metadata)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (state) DO UPDATE
       SET code_challenge = EXCLUDED.code_challenge,
           redirect_uri = EXCLUDED.redirect_uri,
           device_id = EXCLUDED.device_id,
           metadata = EXCLUDED.metadata,
           created_at = NOW()
       RETURNING state, code_challenge, redirect_uri, device_id, created_at, metadata`,
      [
        input.state,
        input.codeChallenge,
        input.redirectUri,
        input.deviceId ?? null,
        input.metadata ?? null,
      ]
    );
    return this.mapAuthState(res.rows[0]);
  }

  async getAuthState(state: string): Promise<MobileAuthStateRow | null> {
    const res = await this.pool.query(
      `SELECT state, code_challenge, redirect_uri, device_id, created_at, metadata
       FROM mobile_auth_states WHERE state = $1`,
      [state]
    );
    return res.rows.length ? this.mapAuthState(res.rows[0]) : null;
  }

  async deleteAuthState(state: string): Promise<void> {
    await this.pool.query(`DELETE FROM mobile_auth_states WHERE state = $1`, [state]);
  }

  async createChallenge(input: CreateAuthChallengeInput): Promise<MobileAuthChallengeRow> {
    const res = await this.pool.query(
      `INSERT INTO mobile_auth_challenges (challenge_id, mfa_token, state, device_id, methods)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (challenge_id) DO UPDATE
       SET mfa_token = EXCLUDED.mfa_token,
           state = EXCLUDED.state,
           device_id = EXCLUDED.device_id,
           methods = EXCLUDED.methods,
           created_at = NOW()
       RETURNING challenge_id, mfa_token, state, device_id, created_at, methods`,
      [
        input.challengeId,
        input.mfaToken,
        input.state,
        input.deviceId ?? null,
        input.methods ?? ['totp'],
      ]
    );
    return this.mapChallenge(res.rows[0]);
  }

  async getChallenge(challengeId: string): Promise<MobileAuthChallengeRow | null> {
    const res = await this.pool.query(
      `SELECT challenge_id, mfa_token, state, device_id, created_at, methods
       FROM mobile_auth_challenges WHERE challenge_id = $1`,
      [challengeId]
    );
    return res.rows.length ? this.mapChallenge(res.rows[0]) : null;
  }

  async deleteChallenge(challengeId: string): Promise<void> {
    await this.pool.query(`DELETE FROM mobile_auth_challenges WHERE challenge_id = $1`, [challengeId]);
  }

  async createSession(input: CreateSessionInput): Promise<MobileDeviceSessionRow> {
    const res = await this.pool.query(
      `INSERT INTO mobile_device_sessions (
          session_id,
          user_id,
          user_email,
          user_name,
          plan,
          device_id,
          refresh_token_hash,
          access_token_expires_at,
          roles,
          client_ids,
          platform,
          push_token,
          metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (session_id) DO UPDATE
       SET refresh_token_hash = EXCLUDED.refresh_token_hash,
           access_token_expires_at = EXCLUDED.access_token_expires_at,
           roles = EXCLUDED.roles,
           client_ids = EXCLUDED.client_ids,
           platform = EXCLUDED.platform,
           push_token = EXCLUDED.push_token,
           metadata = EXCLUDED.metadata,
           user_email = EXCLUDED.user_email,
           user_name = EXCLUDED.user_name,
           plan = EXCLUDED.plan,
           last_seen_at = NOW()
       RETURNING session_id, user_id, user_email, user_name, plan, device_id, refresh_token_hash,
                 access_token_expires_at, roles, client_ids, platform, push_token, metadata,
                 last_seen_at, created_at`,
      [
        input.sessionId,
        input.userId,
        input.userEmail ?? null,
        input.userName ?? null,
        input.plan ?? null,
        input.deviceId,
        input.refreshTokenHash,
        input.accessTokenExpiresAt,
        input.roles,
        input.clientIds,
        input.platform ?? null,
        input.pushToken ?? null,
        input.metadata ?? null,
      ]
    );
    return this.mapSession(res.rows[0]);
  }

  async getSession(sessionId: string): Promise<MobileDeviceSessionRow | null> {
    const res = await this.pool.query(
      `SELECT session_id, user_id, user_email, user_name, plan, device_id, refresh_token_hash,
              access_token_expires_at, roles, client_ids, platform, push_token, metadata,
              last_seen_at, created_at
       FROM mobile_device_sessions
       WHERE session_id = $1`,
      [sessionId]
    );
    return res.rows.length ? this.mapSession(res.rows[0]) : null;
  }

  async findByRefreshHash(refreshTokenHash: string): Promise<MobileDeviceSessionRow | null> {
    const res = await this.pool.query(
      `SELECT session_id, user_id, user_email, user_name, plan, device_id, refresh_token_hash,
              access_token_expires_at, roles, client_ids, platform, push_token, metadata,
              last_seen_at, created_at
       FROM mobile_device_sessions
       WHERE refresh_token_hash = $1`,
      [refreshTokenHash]
    );
    return res.rows.length ? this.mapSession(res.rows[0]) : null;
  }

  async updateSession(input: UpdateSessionInput): Promise<MobileDeviceSessionRow | null> {
    const res = await this.pool.query(
      `UPDATE mobile_device_sessions
       SET refresh_token_hash = CASE WHEN $2 THEN $3 ELSE refresh_token_hash END,
           access_token_expires_at = CASE WHEN $4 THEN $5 ELSE access_token_expires_at END,
           push_token = CASE WHEN $6 THEN $7 ELSE push_token END,
           platform = CASE WHEN $8 THEN $9 ELSE platform END,
           metadata = CASE WHEN $10 THEN $11 ELSE metadata END,
           last_seen_at = CASE WHEN $12 THEN $13 ELSE NOW() END
       WHERE session_id = $1
       RETURNING session_id, user_id, user_email, user_name, plan, device_id, refresh_token_hash,
                 access_token_expires_at, roles, client_ids, platform, push_token, metadata,
                 last_seen_at, created_at`,
      [
        input.sessionId,
        input.refreshTokenHash !== undefined,
        input.refreshTokenHash ?? null,
        input.accessTokenExpiresAt !== undefined,
        input.accessTokenExpiresAt ?? null,
        input.pushToken !== undefined,
        input.pushToken ?? null,
        input.platform !== undefined,
        input.platform ?? null,
        input.metadata !== undefined,
        input.metadata ?? null,
        input.lastSeenAt !== undefined,
        input.lastSeenAt ?? new Date(),
      ]
    );
    return res.rows.length ? this.mapSession(res.rows[0]) : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.pool.query(`DELETE FROM mobile_device_sessions WHERE session_id = $1`, [sessionId]);
  }

  async deleteSessionsForUser(userId: string): Promise<number> {
    const res = await this.pool.query(`DELETE FROM mobile_device_sessions WHERE user_id = $1`, [userId]);
    return res.rowCount ?? 0;
  }
}
