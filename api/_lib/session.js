import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'rd_session';
export const STATE_COOKIE = 'rd_oauth';
const SESSION_DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters');
  return s;
}

const mac = body => createHmac('sha256', secret()).update(body).digest('base64url');

/** A session is `<payload>.<hmac>`, where the payload is base64url JSON {uid, exp}. */
export function signSession(uid, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ uid, exp: now + SESSION_DAYS * 86400e3 })).toString('base64url');
  return `${body}.${mac(body)}`;
}

/** Returns the user id, or null if the token is missing, forged or expired. */
export function readSession(token, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(mac(body));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof exp === 'number' && exp > now && uid != null ? uid : null;
  } catch {
    return null;
  }
}

export function cookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export const sessionCookie = uid => cookie(SESSION_COOKIE, signSession(uid), SESSION_DAYS * 86400);
export const clearCookie = name => cookie(name, '', 0);

/** The signed-in user's id for this request, or null. */
export const userId = req => readSession(req.cookies?.[SESSION_COOKIE]);

/** The public origin this request arrived at, e.g. https://ragnaduck.vercel.app */
export const origin = req => `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
