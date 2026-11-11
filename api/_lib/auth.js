// Sign-in is handled by Neon Auth (managed Better Auth). The browser never talks to
// Neon's domain: api/auth.js proxies it under /api/auth, so the session cookie belongs
// to this site and is not blocked as a third-party cookie.
import { handleAuthProxyRequest } from '@neon/auth/server';
import { sql } from './db.js';

export function authConfig() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !cookieSecret) throw new Error('NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET must be set');
  return { baseUrl: baseUrl.replace(/\/+$/, ''), cookieSecret };
}

/**
 * The signed-in account for an API request, read from the session cookie.
 * Returns {user, cookies}: `user` is Neon Auth's user ({id, name, email, ...}) or null;
 * `cookies` are Set-Cookie strings the response should carry (the SDK refreshes a short
 * signed cache cookie so most calls skip the round trip to Neon Auth).
 */
export async function currentUser(request) {
  const cookie = request.headers.get('cookie') || '';
  if (!cookie.includes('neon-auth.session_token')) return { user: null, cookies: [] };
  const url = new URL('/api/auth/get-session', request.url);
  const probe = new Request(url, { headers: { cookie, origin: url.origin, 'user-agent': request.headers.get('user-agent') || 'ragnaduck' } });
  const res = await handleAuthProxyRequest({ request: probe, path: 'get-session', ...authConfig() });
  if (!res.ok) return { user: null, cookies: [] };
  const data = await res.json().catch(() => null);
  const user = data?.session && typeof data.user?.id === 'string' ? data.user : null;
  return { user, cookies: res.headers.getSetCookie() };
}

/** Leaderboard names: 2-24 visible characters. Returns null if nothing usable is left. */
export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFKC').replace(/[\p{C}\p{Z}]+/gu, ' ').trim().slice(0, 24).trim();
  return name.length >= 2 ? name : null;
}

/**
 * The player row for an account, created on first use. The default display name is the
 * first word of the account name, so a full real name from Google is not published.
 */
export async function playerFor(user) {
  const fallback = cleanName(String(user.name || '').trim().split(/\s+/)[0]) || cleanName(String(user.email || '').split('@')[0]) || 'Viking';
  await sql`INSERT INTO players (user_id, name) VALUES (${user.id}, ${fallback}) ON CONFLICT (user_id) DO NOTHING`;
  const [p] = await sql`SELECT id, name, banned FROM players WHERE user_id = ${user.id}`;
  return { id: Number(p.id), name: p.name, banned: p.banned };
}

/** Shorthand for routes that need a signed-in player: {player, cookies} with player null when signed out. */
export async function currentPlayer(request) {
  const { user, cookies } = await currentUser(request);
  return { player: user ? await playerFor(user) : null, cookies };
}
