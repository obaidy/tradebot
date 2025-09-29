import Head from 'next/head';
import Link from 'next/link';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

const SECTIONS = [
  {
    title: 'Generate a dedicated key',
    body: [
      'Create a fresh Ethereum private key locally (MetaMask “Create account”, hardware wallet export, or `ethers.Wallet.createRandom()`).',
      'Never reuse exchange keys; this wallet is only for Flashbots bundles.',
    ],
  },
  {
    title: 'Store it securely in OctoBot',
    body: [
      'In the dashboard, open the MEV bot card and click “Add key”. Paste the private key. We encrypt it with your master key and store it per client.',
      'You can rotate or remove the key at any time from the same panel.',
    ],
  },
  {
    title: 'Fund the wallet with ETH',
    body: [
      'After the key saves, we show the derived address. Send ETH from any wallet (MetaMask, Ledger, exchange withdrawal).',
      'Keep at least 0.05 ETH available; the UI warns when balance drops below ~0.02 ETH.',
    ],
  },
  {
    title: 'Launch and monitor',
    body: [
      'Once funded, queue a live MEV run. Each bundle is signed inside your runner and submitted via Flashbots.',
      'Review the balance and rotate the key after major upgrades or if you suspect compromise.',
    ],
  },
  {
    title: 'Enterprise custody (optional)',
    body: [
      'If you require managed custody, open a support ticket. We can set up dedicated HSM rotation and multi-sig approvals for Enterprise plans.',
    ],
  },
];

export default function MevWalletGuide() {
  return (
    <>
      <Head>
        <title>MEV Wallet Onboarding · OctoBot Portal</title>
      </Head>
      <DashboardLayout
        topRightSlot={
          <Link href="/app" legacyBehavior>
            <a>
              <Button variant="secondary">Back to dashboard</Button>
            </a>
          </Link>
        }
      >
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          <Card style={{ display: 'grid', gap: '1rem' }}>
            <Badge tone="primary">MEV Arb Bot</Badge>
            <h1 style={{ margin: 0 }}>MEV Wallet Onboarding Checklist</h1>
            <p style={{ margin: 0, color: '#94A3B8' }}>
              Follow these steps before launching live runs. The Flashbots wallet stays under your control—OctoBot only uses it inside your dedicated runner.
            </p>
          </Card>

          {SECTIONS.map((section) => (
            <Card key={section.title} style={{ display: 'grid', gap: '0.75rem' }}>
              <h2 style={{ margin: 0 }}>{section.title}</h2>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#E2E8F0', display: 'grid', gap: '0.5rem' }}>
                {section.body.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ))}

          <Card elevation="none" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)', display: 'grid', gap: '0.75rem' }}>
            <h2 style={{ margin: 0 }}>Ready to run?</h2>
            <p style={{ margin: 0, color: '#94A3B8' }}>
              When the balance card in your dashboard shows sufficient ETH, queue a live MEV run from the ‘Start live’ button. Keep an eye on the balance alert for top-ups.
            </p>
            <div>
              <Link href="/app" legacyBehavior>
                <a>
                  <Button variant="primary">Return to dashboard</Button>
                </a>
              </Link>
            </div>
          </Card>
        </div>
      </DashboardLayout>
    </>
  );
}
