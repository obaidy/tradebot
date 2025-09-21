import type { AppProps } from 'next/app';
import { SessionProvider } from 'next-auth/react';
import '../styles/global.css';

type AppPropsWithAuth = AppProps & {
  pageProps: {
    session?: any;
  };
};

function App({ Component, pageProps: { session, ...pageProps } }: AppPropsWithAuth) {
  return (
    <SessionProvider session={session}>
      <Component {...pageProps} />
    </SessionProvider>
  );
}

export default App;
