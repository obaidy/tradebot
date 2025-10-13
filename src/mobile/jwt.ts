import crypto from 'crypto';

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = 4 - (normalized.length % 4 || 4);
  const padded = normalized + '='.repeat(padLength === 4 ? 0 : padLength);
  return Buffer.from(padded, 'base64');
}

function encodeSegment(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  return toBase64Url(Buffer.from(json, 'utf8'));
}

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  options: { expiresInSeconds: number }
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + Math.max(options.expiresInSeconds, 1),
  };
  const headerSegment = encodeSegment(header);
  const payloadSegment = encodeSegment(body);
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const signatureSegment = toBase64Url(signature);
  return `${signingInput}.${signatureSegment}`;
}

export function verifyJwt<T = Record<string, unknown>>(token: string, secret: string): T {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('invalid_token_format');
  }
  const [encodedHeader, encodedPayload, providedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignatureBuffer = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const providedSignatureBuffer = fromBase64Url(providedSignature);
  if (expectedSignatureBuffer.length !== providedSignatureBuffer.length) {
    throw new Error('invalid_token_signature');
  }
  if (!crypto.timingSafeEqual(expectedSignatureBuffer, providedSignatureBuffer)) {
    throw new Error('invalid_token_signature');
  }
  const payloadBuffer = fromBase64Url(encodedPayload);
  let payload: any;
  try {
    payload = JSON.parse(payloadBuffer.toString('utf8'));
  } catch (err) {
    throw new Error('invalid_token_payload');
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new Error('token_expired');
  }
  return payload as T;
}
