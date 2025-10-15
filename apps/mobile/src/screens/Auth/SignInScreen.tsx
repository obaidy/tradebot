import React, { useState } from 'react';
import { View, Platform } from 'react-native';
import { makeRedirectUri, generateHexStringAsync } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useTheme } from '@/theme';
import { ThemedText } from '@/components/ThemedText';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAppDispatch, useAppSelector } from '@/hooks/store';
import { selectAuthError, setAuthenticated, setAuthError } from '@/state/slices/authSlice';
import { beginPkceSignIn, exchangeCodeForSession, registerDevice, verifyMfaChallenge } from '@/services/authClient';
import { saveSession } from '@/services/sessionStorage';
import type { PersistedSession } from '@/services/sessionStorage';
import { registerForPushNotifications } from '@/services/pushNotifications';
import { Verify2FAScreen } from './Verify2FAScreen';

export const SignInScreen: React.FC = () => {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const existingError = useAppSelector(selectAuthError);
  const [loading, setLoading] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<{ challengeId: string; deviceId: string } | null>(null);

  const finalizeSession = async (session: PersistedSession) => {
    let pushToken: string | null = null;
    try {
      pushToken = await registerForPushNotifications();
    } catch (err) {
      if (__DEV__) {
        console.warn('[notifications] registerForPushNotifications failed', err);
      }
    }

    const sessionWithPush: PersistedSession = pushToken ? { ...session, pushToken } : session;
    await saveSession(sessionWithPush);
    dispatch(
      setAuthenticated({
        tokens: session.tokens,
        user: session.user,
        deviceId: session.deviceId,
        pushToken: pushToken ?? undefined,
      })
    );
    await registerDevice(
      {
        deviceId: session.deviceId,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        appVersion: Device.osVersion ?? 'unknown',
        pushToken: pushToken ?? undefined,
      },
      session.tokens.accessToken
    );
  };

  const handleVerifyMfa = async (code: string) => {
    if (!mfaChallenge) return;
    const session = await verifyMfaChallenge({
      challengeId: mfaChallenge.challengeId,
      otp: code,
      deviceId: mfaChallenge.deviceId,
    });
    await finalizeSession(session);
    setMfaChallenge(null);
  };

  const sanitizeCodeVerifier = (raw: string) => raw.replace(/[^a-zA-Z0-9\-._~]/g, '');

  const handleSignIn = async () => {
    setLoading(true);
    try {
      const codeVerifier = sanitizeCodeVerifier(await generateHexStringAsync(64));
      const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        codeVerifier,
        { encoding: Crypto.CryptoEncoding.BASE64 }
      );
      const codeChallenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const redirectUri = makeRedirectUri({ path: 'auth/callback' });
      if (__DEV__) {
        console.log('[auth] redirectUri', redirectUri);
      }
      const deviceId = Crypto.randomUUID();
      const start = await beginPkceSignIn({
        codeChallenge,
        redirectUri,
        deviceId,
      });
      const authResult = await WebBrowser.openAuthSessionAsync(start.authorizationUrl, redirectUri);

      if (authResult.type !== 'success' || !authResult.url) {
        throw new Error('Authentication was cancelled');
      }
      const parsed = Linking.parse(authResult.url);
      const params = parsed.queryParams ?? {};
      const code = typeof params.code === 'string' ? params.code : undefined;
      const returnedState = typeof params.state === 'string' ? params.state : undefined;

      if (!code) {
        throw new Error('Authorization code missing in redirect');
      }
      if (returnedState !== start.state) {
        throw new Error('State validation failed');
      }

      const exchange = await exchangeCodeForSession({
        state: returnedState,
        code,
        codeVerifier,
        redirectUri,
        deviceId,
      });

      if (exchange.type === 'mfa') {
        setMfaChallenge({ challengeId: exchange.challengeId, deviceId });
        return;
      }

      await finalizeSession(exchange.session);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign in';
      dispatch(setAuthError(message));
    } finally {
      setLoading(false);
    }
  };

  if (mfaChallenge) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: theme.spacing(4),
          backgroundColor: theme.colors.background,
        }}
      >
        <Verify2FAScreen onSubmit={handleVerifyMfa} onCancel={() => setMfaChallenge(null)} />
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.spacing(4),
        backgroundColor: theme.colors.background,
        gap: theme.spacing(2),
      }}
    >
      <View style={{ alignItems: 'center', gap: theme.spacing(1) }}>
        <ThemedText variant="headline" weight="bold">
          TradeBot Mobile
        </ThemedText>
        <ThemedText variant="body" muted style={{ textAlign: 'center' }}>
          Sign in with your TradeBot credentials to access real-time strategy controls and alerts.
        </ThemedText>
      </View>

      {existingError ? (
        <ThemedText variant="body" style={{ color: theme.colors.negative }}>
          {existingError}
        </ThemedText>
      ) : null}

      <PrimaryButton label="Sign in" onPress={handleSignIn} loading={loading} style={{ alignSelf: 'stretch' }} />
    </View>
  );
};
