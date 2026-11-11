import { sql } from './_lib/db.js';

// GET /api/leaderboard?period=all|week: each player's best valid run, top 50.
export default async function handler(req, res) {
  const week = req.query?.period === 'week';
  const since = week ? new Date(Date.now() - 7 * 86400e3) : new Date(0);
  const rows = await sql`
    SELECT * FROM (
      SELECT DISTINCT ON (r.user_id) r.user_id, u.name, r.score, r.wave, r.kills, r.finished_at
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.flagged IS NULL AND r.score IS NOT NULL AND NOT u.banned AND r.finished_at > ${since.toISOString()}
      ORDER BY r.user_id, r.score DESC, r.finished_at
    ) best
    ORDER BY score DESC, finished_at
    LIMIT 50`;
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
  res.status(200).json({
    period: week ? 'week' : 'all',
    rows: rows.map((r, i) => ({ rank: i + 1, id: Number(r.user_id), name: r.name, score: r.score, wave: r.wave, kills: r.kills })),
  });
}
