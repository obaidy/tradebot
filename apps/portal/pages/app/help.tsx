import Head from 'next/head';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { faqItems } from '../../styles/theme';

export default function HelpPage() {
  return (
    <DashboardLayout>
      <Head>
        <title>Help · OctoBot Portal</title>
      </Head>
      <header style={{ marginBottom: '1.5rem' }}>
        <Badge tone="primary">Support</Badge>
        <h1 style={{ margin: '0.5rem 0 0' }}>FAQ &amp; docs</h1>
        <p style={{ margin: '0.35rem 0 0' }}>
          Straight answers to the questions we get most. If you need higher bandwidth just drop us a note.
        </p>
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1rem',
        }}
      >
        {faqItems.map((item) => (
          <Card key={item.question}>
            <h3 style={{ marginTop: 0 }}>{item.question}</h3>
            <p style={{ margin: '0.35rem 0 0' }}>{item.answer}</p>
          </Card>
        ))}
      </section>

      <Card style={{ marginTop: '2rem' }}>
        <h3 style={{ marginTop: 0 }}>Still stuck?</h3>
        <p>
          Email <a href="mailto:hello@octobot.ai">hello@octobot.ai</a> with your client ID and we’ll get back quickly.
          We can hop on a call for onboarding or compliance reviews.
        </p>
        <Button
          onClick={() => {
            window.location.href = 'mailto:hello@octobot.ai';
          }}
        >
          Contact support
        </Button>
      </Card>
    </DashboardLayout>
  );
}

