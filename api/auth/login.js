import { randomBytes } from 'node:crypto';
import { cookie, origin, STATE_COOKIE } from '../_lib/session.js';

// GET /api/auth/login: sends the player to GitHub to sign in.
export default function handler(req, res) {
  const state = randomBytes(16).toString('hex');
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${origin(req)}/api/auth/callback`);
  url.searchParams.set('state', state);
  res.setHeader('Set-Cookie', cookie(STATE_COOKIE, state, 600));
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, url.toString());
}
