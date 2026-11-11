import { sql } from './_lib/db.js';
import { userId } from './_lib/session.js';
import { standing } from './_lib/board.js';

// GET /api/me: who is signed in, with their stats. {user: null} when signed out.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const uid = userId(req);
  if (uid == null) return res.status(200).json({ user: null });
  const [user] = await sql`SELECT id, name, avatar_url FROM users WHERE id = ${uid}`;
  if (!user) return res.status(200).json({ user: null });
  const [t] = await sql`
    SELECT count(*) AS runs, coalesce(sum(kills), 0) AS kills, coalesce(max(wave), 0) AS wave,
           coalesce(max(max_combo), 0) AS combo, coalesce(sum(duration_ms), 0) AS ms
    FROM runs WHERE user_id = ${uid} AND flagged IS NULL AND score IS NOT NULL`;
  const { best, rank } = await standing(uid);
  res.status(200).json({
    user: { id: Number(user.id), name: user.name, avatar: user.avatar_url },
    stats: {
      best, rank, runs: Number(t.runs), kills: Number(t.kills), bestWave: Number(t.wave),
      bestCombo: Number(t.combo), minutes: Math.round(Number(t.ms) / 60000),
    },
  });
}
