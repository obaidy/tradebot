import { signIn, signOut, useSession } from 'next-auth/react';
import Head from 'next/head';
import Link from 'next/link';

export default function Home() {
  const { data: session, status } = useSession();
  const loading = status === 'loading';

  return (
    <>
      <Head>
        <title>TradeBot Portal</title>
      </Head>
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <section style={{ maxWidth: 420, width: '100%', padding: '2rem', background: '#111827', borderRadius: 16 }}>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '1rem' }}>TradeBot Portal</h1>
          {loading && <p>Checking your session…</p>}
          {!loading && !session && (
            <>
              <p style={{ marginBottom: '1.5rem' }}>
                Sign in to manage your trading plan, API keys, and view onboarding steps.
              </p>
              <button
                type="button"
                onClick={() => signIn('auth0')}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: 12,
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Continue with Auth0
              </button>
            </>
          )}
          {session && (
            <>
              <p style={{ marginBottom: '1rem' }}>
                Signed in as <strong>{session.user?.email ?? session.user?.id}</strong>
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Link href="/app" legacyBehavior>
                  <a
                    style={{
                      flex: 1,
                      padding: '0.75rem 1rem',
                      borderRadius: 12,
                      background: '#22c55e',
                      color: '#111827',
                      fontWeight: 600,
                      textAlign: 'center',
                    }}
                  >
                    Enter Portal
                  </a>
                </Link>
                <button
                  type="button"
                  onClick={() => signOut()}
                  style={{
                    flex: 1,
                    padding: '0.75rem 1rem',
                    borderRadius: 12,
                    border: '1px solid #64748b',
                    background: 'transparent',
                    color: '#e2e8f0',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}
