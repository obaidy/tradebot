import Head from 'next/head';
import type { AppProps } from 'next/app';
import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import '../styles/global.css';
import { OctopusLoader } from '../components/ui/OctopusLoader';

function App({ Component, pageProps: { session, ...pageProps } }: AppProps<{ session: Session | null }>) {
  return (
    <SessionProvider session={session}>
      <Head>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/favicon.png" />
      </Head>
      <Component {...pageProps} />
      <OctopusLoader />
    </SessionProvider>
  );
}

export default App;
