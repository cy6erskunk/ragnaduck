import { clearCookie, SESSION_COOKIE } from '../_lib/session.js';

// POST /api/auth/logout
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE));
  res.status(200).json({ ok: true });
}
