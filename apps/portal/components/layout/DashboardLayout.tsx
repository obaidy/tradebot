import Image from 'next/image';
import Link from 'next/link';
import { ReactNode, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { palette, typography } from '../../styles/theme';

export interface NavLink {
  label: string;
  href: string;
  icon?: ReactNode;
}

const navLinks: NavLink[] = [
  { label: 'Overview', href: '/app' },
  { label: 'Bots', href: '/app/bots' },
  { label: 'Exchanges', href: '/app/exchanges' },
  { label: 'Activity', href: '/app/activity' },
  { label: 'Billing', href: '/app/billing' },
  { label: 'Settings', href: '/app/settings' },
];

interface DashboardLayoutProps {
  children: ReactNode;
  topRightSlot?: ReactNode;
}

export function DashboardLayout({ children, topRightSlot }: DashboardLayoutProps) {
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  const activeHref = useMemo(() => {
    const match = navLinks
      .slice()
      .sort((a, b) => b.href.length - a.href.length)
      .find((link) => router.pathname.startsWith(link.href));
    return match?.href ?? '/app';
  }, [router.pathname]);

  return (
    <div className="dashboard-shell">
      <aside
        className={`dashboard-nav ${navOpen ? 'open' : ''}`}
        style={{
          borderRight: '1px solid rgba(148, 163, 184, 0.12)',
          padding: '2rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '2.5rem',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Image src="/octobot-logo.svg" alt="OctoBot" width={32} height={32} />
            <span
              style={{
                fontFamily: typography.fontFamily,
                fontWeight: 700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                fontSize: '0.85rem',
                color: palette.primary,
              }}
            >
              OctoBot
            </span>
          </div>
          <h1 style={{ margin: '0.65rem 0 0', fontSize: '1.4rem', letterSpacing: '-0.01em' }}>Operator Console</h1>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {navLinks.map((link) => {
            const isActive = activeHref === link.href;
            return (
              <Link key={link.href} href={link.href} legacyBehavior>
                <a
                  onClick={() => setNavOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    fontWeight: isActive ? 600 : 500,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    fontSize: '0.75rem',
                    background: isActive ? 'rgba(56,189,248,0.12)' : 'transparent',
                    color: isActive ? palette.primary : palette.textSecondary,
                    border: isActive ? '1px solid rgba(56,189,248,0.25)' : '1px solid transparent',
                    transition: 'background 0.25s ease, color 0.25s ease, transform 0.25s ease',
                  }}
                >
                  <span style={{ flex: 1 }}>{link.label}</span>
                  {isActive ? <span style={{ fontSize: '0.85rem' }}>→</span> : null}
                </a>
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: 'auto', fontSize: '0.75rem', color: palette.textSecondary, lineHeight: 1.6 }}>
          <p style={{ margin: 0 }}>Release window: Tuesday 14:00 UTC</p>
          <p style={{ margin: 0 }}>Paper canary: auto-run on merge to main</p>
          <p style={{ margin: 0 }}>On-call: operations@octobot.ai</p>
        </div>
      </aside>
      {navOpen ? <div className="dashboard-overlay" onClick={() => setNavOpen(false)} /> : null}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', overflow: 'hidden' }}>
        <header
          style={{
            padding: '1.5rem 2rem',
            borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: 'rgba(5,8,22,0.92)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              type="button"
              className="dashboard-menu"
              onClick={() => setNavOpen((prev) => !prev)}
              aria-label="Toggle navigation"
            >
              ☰
            </button>
            <p style={{ margin: 0, fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: palette.textSecondary }}>
              Today’s cadence
            </p>
            <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.35rem' }}>Grid operations overview</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>{topRightSlot}</div>
        </header>
        <main style={{ flex: 1, overflowY: 'auto', padding: '2rem', background: 'rgba(5,8,22,0.7)' }}>{children}</main>
      </div>
    </div>
  );
}
