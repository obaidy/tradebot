import useSWR from 'swr';
import type { PortalBootstrap } from '../types/portal';

async function fetcher(url: string): Promise<PortalBootstrap> {
  const res = await fetch(url);
  if (!res.ok) {
    let detail: any = null;
    try {
      detail = await res.json();
    } catch {
      // ignore
    }
    const message = detail?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return res.json();
}

export function usePortalBootstrap(enabled = true) {
  const { data, error, isValidating, mutate } = useSWR<PortalBootstrap>(
    enabled ? '/api/client/bootstrap' : null,
    fetcher,
    {
      revalidateOnFocus: false,
    }
  );
  return {
    data,
    error,
    loading: enabled && !data && !error,
    refreshing: isValidating,
    refresh: mutate,
  };
}
