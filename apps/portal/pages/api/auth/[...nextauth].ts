import NextAuth from 'next-auth';
import { authOptions } from '../../../lib/authOptions';

export { authOptions };
export default NextAuth(authOptions);
