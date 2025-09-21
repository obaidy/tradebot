import { NextAuthOptions } from 'next-auth';
import Auth0Provider from 'next-auth/providers/auth0';

const auth0Domain = process.env.AUTH0_ISSUER_BASE_URL;
const auth0ClientId = process.env.AUTH0_CLIENT_ID;
const auth0ClientSecret = process.env.AUTH0_CLIENT_SECRET;

if (!process.env.NEXTAUTH_SECRET) {
  // eslint-disable-next-line no-console
  console.warn('NEXTAUTH_SECRET is not set. Sessions may be insecure in production.');
}

export const authOptions: NextAuthOptions = {
  providers: [
    Auth0Provider({
      clientId: auth0ClientId ?? '',
      clientSecret: auth0ClientSecret ?? '',
      issuer: auth0Domain,
      authorization: {
        params: {
          scope: 'openid email profile',
        },
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? session.user.email ?? '';
      }
      return session;
    },
  },
};
