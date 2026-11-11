import { sql } from '../_lib/db.js';
import { sessionCookie, clearCookie, origin, STATE_COOKIE } from '../_lib/session.js';

// GET /api/auth/callback: GitHub sends the player back here with a one-time code.
// Only the public profile is read (no scopes are requested), and the GitHub token is not stored.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { code, state } = req.query || {};
  const expected = req.cookies?.[STATE_COOKIE];
  if (typeof code !== 'string' || typeof state !== 'string' || !expected || state !== expected) {
    return res.status(400).send('Sign-in failed: the request did not start here. Go back and try again.');
  }
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${origin(req)}/api/auth/callback`,
    }),
  });
  const token = (await tokenRes.json()).access_token;
  if (!token) return res.status(400).send('Sign-in failed: GitHub did not accept the code. Go back and try again.');
  const profileRes = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'ragnaduck' },
  });
  const profile = await profileRes.json();
  if (!profileRes.ok || !Number.isSafeInteger(profile.id)) return res.status(502).send('Sign-in failed: could not read your GitHub profile.');
  const [user] = await sql`
    INSERT INTO users (github_id, name, avatar_url) VALUES (${profile.id}, ${String(profile.login).slice(0, 60)}, ${profile.avatar_url || null})
    ON CONFLICT (github_id) DO UPDATE SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
    RETURNING id`;
  res.setHeader('Set-Cookie', [sessionCookie(Number(user.id)), clearCookie(STATE_COOKIE)]);
  res.redirect(302, '/');
}
