import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const SESSION_COOKIE = 'ya_session';

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createPublicToken() {
  return randomBytes(32).toString('base64url');
}

export function signSession(user) {
  return jwt.sign({ sub: user._id.toString() }, env.JWT_SECRET, {
    expiresIn: '1h',
    issuer: 'your-appointment',
    audience: 'your-appointment-web',
  });
}

export function verifySession(token) {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: 'your-appointment',
    audience: 'your-appointment-web',
  });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api',
    maxAge: 60 * 60 * 1000,
  };
}
