import type { AppProps } from 'next/app';
import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import '../styles/global.css';

function App({ Component, pageProps: { session, ...pageProps } }: AppProps<{ session: Session | null }>) {
  return (
    <SessionProvider session={session}>
      <Component {...pageProps} />
    </SessionProvider>
  );
}

export default App;
