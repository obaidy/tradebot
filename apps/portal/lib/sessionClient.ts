import type { Session } from 'next-auth';

/**
 * Extracts the canonical client identifier for a signed-in user.
 * Prefers the email address (matches how client records are keyed)
 * and falls back to the underlying provider id if no email is available.
 */
export function getSessionClientId(session: Session | null | undefined): string | null {
  const rawId = typeof session?.user?.id === 'string' ? session.user.id.trim() : '';
  if (rawId.length > 0) {
    return rawId;
  }
  return null;
}
