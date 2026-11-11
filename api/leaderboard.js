import { sql } from './_lib/db.js';
import { json, route } from './_lib/http.js';

// GET /api/leaderboard?period=all|week: each player's best valid run, top 50.
export default route({
  async GET(request) {
    const week = new URL(request.url).searchParams.get('period') === 'week';
    const since = week ? new Date(Date.now() - 7 * 86400e3) : new Date(0);
    const rows = await sql`
      SELECT * FROM (
        SELECT DISTINCT ON (r.player_id) r.player_id, p.name, r.score, r.wave, r.kills, r.finished_at
        FROM runs r JOIN players p ON p.id = r.player_id
        WHERE r.flagged IS NULL AND r.score IS NOT NULL AND NOT p.banned AND r.finished_at > ${since.toISOString()}
        ORDER BY r.player_id, r.score DESC, r.finished_at
      ) best
      ORDER BY score DESC, finished_at
      LIMIT 50`;
    return json({
      period: week ? 'week' : 'all',
      rows: rows.map((r, i) => ({ rank: i + 1, id: Number(r.player_id), name: r.name, score: r.score, wave: r.wave, kills: r.kills })),
    }, 200, { cache: 'public, s-maxage=15, stale-while-revalidate=60' });
  },
});
