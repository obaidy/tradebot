import { NextAuthOptions } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
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
    async jwt({ token, user }) {
      if (user?.email) {
        (token as JWT & { email?: string }).email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const typedToken = token as JWT & { email?: string };
        const email = typedToken.email ?? session.user.email ?? null;
        const subject = typeof token.sub === 'string' && token.sub.length > 0 ? token.sub : null;
        session.user.id = subject ?? email ?? session.user.email ?? '';
        if (email) {
          session.user.email = email;
        }
      }
      return session;
    },
  },
};
