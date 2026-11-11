import { sql } from './db.js';

/** A player's best valid score and their place on the all-time board (null if they have none). */
export async function standing(playerId) {
  const [row] = await sql`
    WITH best AS (
      SELECT r.player_id, max(r.score) AS score
      FROM runs r JOIN players p ON p.id = r.player_id
      WHERE r.flagged IS NULL AND r.score IS NOT NULL AND NOT p.banned
      GROUP BY r.player_id
    )
    SELECT mine.score AS best,
           (SELECT count(*) FROM best WHERE best.score > mine.score) + 1 AS rank
    FROM best mine WHERE mine.player_id = ${playerId}`;
  return row ? { best: Number(row.best), rank: Number(row.rank) } : { best: null, rank: null };
}
