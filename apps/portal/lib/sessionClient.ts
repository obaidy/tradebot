import type { Session } from 'next-auth';

/**
 * Extracts the canonical client identifier for a signed-in user.
 * Prefers the email address (matches how client records are keyed)
 * and falls back to the underlying provider id if no email is available.
 */
export function getSessionClientId(session: Session | null | undefined): string | null {
  if (!session?.user) return null;
  const email = session.user.email?.trim();
  if (email) return email;
  const name = session.user.name?.trim();
  if (name && name.includes('@')) return name;
  const id = typeof session.user.id === 'string' ? session.user.id.trim() : null;
  return id && id.length > 0 ? id : null;
}
