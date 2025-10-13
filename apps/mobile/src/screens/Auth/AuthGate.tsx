import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAppDispatch, useAppSelector } from '@/hooks/store';
import { beginAuth, selectAuthStatus, setAuthenticated, setAuthError, signOut } from '@/state/slices/authSlice';
import { loadSession } from '@/services/sessionStorage';
import { SignInScreen } from './SignInScreen';
import { useTheme } from '@/theme';

interface Props {
  children: React.ReactNode;
}

export const AuthGate: React.FC<Props> = ({ children }) => {
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectAuthStatus);
  const theme = useTheme();

  useEffect(() => {
    let mounted = true;
    dispatch(beginAuth());
    loadSession()
      .then((session) => {
        if (!mounted) return;
        if (session) {
          dispatch(setAuthenticated(session));
        } else {
          dispatch(signOut());
        }
      })
      .catch((err) => {
        if (!mounted) return;
        dispatch(setAuthError(err instanceof Error ? err.message : String(err)));
      });

    return () => {
      mounted = false;
    };
  }, [dispatch]);

  if (status === 'checking') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.background,
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  if (status === 'authenticated') {
    return <>{children}</>;
  }

  return <SignInScreen />;
};
