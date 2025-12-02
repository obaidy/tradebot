import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { usePortalBootstrap } from './usePortalBootstrap';

export function usePortalData(options?: { enabled?: boolean; allowOnboarding?: boolean }) {
  const router = useRouter();
  const { data, error, loading, refreshing, refresh } = usePortalBootstrap(options?.enabled !== false);

  useEffect(() => {
    if (!options?.allowOnboarding && !loading && data?.needsOnboarding && router.pathname !== '/onboarding') {
      router.replace('/onboarding');
    }
  }, [data?.needsOnboarding, loading, options?.allowOnboarding, router]);

  return { data, error, loading, refreshing, refresh };
}

