"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Home;
const react_1 = require("next-auth/react");
const head_1 = __importDefault(require("next/head"));
const link_1 = __importDefault(require("next/link"));
function Home() {
    const { data: session, status } = (0, react_1.useSession)();
    const loading = status === 'loading';
    return (<>
      <head_1.default>
        <title>TradeBot Portal</title>
      </head_1.default>
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <section style={{ maxWidth: 420, width: '100%', padding: '2rem', background: '#111827', borderRadius: 16 }}>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '1rem' }}>TradeBot Portal</h1>
          {loading && <p>Checking your session…</p>}
          {!loading && !session && (<>
              <p style={{ marginBottom: '1.5rem' }}>
                Sign in to manage your trading plan, API keys, and view onboarding steps.
              </p>
              <button type="button" onClick={() => (0, react_1.signIn)('auth0')} style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: 12,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
            }}>
                Continue with Auth0
              </button>
            </>)}
          {session && (<>
              <p style={{ marginBottom: '1rem' }}>
                Signed in as <strong>{session.user?.email ?? session.user?.id}</strong>
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <link_1.default href="/app" legacyBehavior>
                  <a style={{
                flex: 1,
                padding: '0.75rem 1rem',
                borderRadius: 12,
                background: '#22c55e',
                color: '#111827',
                fontWeight: 600,
                textAlign: 'center',
            }}>
                    Enter Portal
                  </a>
                </link_1.default>
                <button type="button" onClick={() => (0, react_1.signOut)()} style={{
                flex: 1,
                padding: '0.75rem 1rem',
                borderRadius: 12,
                border: '1px solid #64748b',
                background: 'transparent',
                color: '#e2e8f0',
                fontWeight: 600,
                cursor: 'pointer',
            }}>
                  Sign out
                </button>
              </div>
            </>)}
        </section>
      </main>
    </>);
}
