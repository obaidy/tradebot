"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Dashboard;
const head_1 = __importDefault(require("next/head"));
const react_1 = require("next-auth/react");
const link_1 = __importDefault(require("next/link"));
function Dashboard() {
    const { data: session, status } = (0, react_1.useSession)({ required: true });
    if (status === 'loading') {
        return (<main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>Loading your workspace…</p>
      </main>);
    }
    return (<>
      <head_1.default>
        <title>Portal Dashboard</title>
      </head_1.default>
      <main style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
        <header style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1.5rem 3rem',
            borderBottom: '1px solid #1e293b',
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Client Workspace</h1>
            <p style={{ margin: 0, color: '#94a3b8' }}>Signed in as {session?.user?.email ?? session?.user?.id}</p>
          </div>
          <button type="button" onClick={() => (0, react_1.signOut)({ callbackUrl: '/' })} style={{
            padding: '0.6rem 1.2rem',
            borderRadius: 10,
            background: '#f87171',
            color: '#111827',
            border: 'none',
            fontWeight: 600,
            cursor: 'pointer',
        }}>
            Sign out
          </button>
        </header>
        <section style={{ padding: '2rem 3rem', display: 'grid', gap: '1.5rem', maxWidth: 960, margin: '0 auto' }}>
          <article style={{ background: '#111c2f', padding: '1.75rem', borderRadius: 16 }}>
            <h2 style={{ marginTop: 0 }}>Next steps</h2>
            <ol style={{ lineHeight: 1.8, color: '#cbd5f5', paddingLeft: '1.25rem' }}>
              <li>Confirm your trading plan and allowable symbols (coming soon).</li>
              <li>Add exchange API keys securely (encrypted at rest).</li>
              <li>Review paper trade metrics and upgrade to live when ready.</li>
            </ol>
          </article>
          <article style={{ background: '#111c2f', padding: '1.75rem', borderRadius: 16 }}>
            <h2 style={{ marginTop: 0 }}>API references</h2>
            <p style={{ color: '#94a3b8' }}>
              The portal will talk to the bot backend through secure REST endpoints.
            </p>
            <ul style={{ lineHeight: 1.7 }}>
              <li><code>GET /clients/me</code> – retrieve your provisioning status.</li>
              <li><code>POST /clients/me/credentials</code> – store or rotate encrypted API keys.</li>
              <li><code>POST /clients/me/paper-run</code> – kick off a paper validation job.</li>
            </ul>
            <link_1.default href="/" legacyBehavior>
              <a style={{ color: '#38bdf8', fontWeight: 600 }}>Return to landing</a>
            </link_1.default>
          </article>
        </section>
      </main>
    </>);
}
