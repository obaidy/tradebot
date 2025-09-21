"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authOptions = void 0;
const auth0_1 = __importDefault(require("next-auth/providers/auth0"));
const auth0Domain = process.env.AUTH0_ISSUER_BASE_URL;
const auth0ClientId = process.env.AUTH0_CLIENT_ID;
const auth0ClientSecret = process.env.AUTH0_CLIENT_SECRET;
if (!process.env.NEXTAUTH_SECRET) {
    // eslint-disable-next-line no-console
    console.warn('NEXTAUTH_SECRET is not set. Sessions may be insecure in production.');
}
exports.authOptions = {
    providers: [
        (0, auth0_1.default)({
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
