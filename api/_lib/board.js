import { sql } from './db.js';

/** A player's best valid score and their place on the all-time board (null if they have none). */
export async function standing(uid) {
  const [row] = await sql`
    WITH best AS (
      SELECT r.user_id, max(r.score) AS score
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.flagged IS NULL AND r.score IS NOT NULL AND NOT u.banned
      GROUP BY r.user_id
    )
    SELECT mine.score AS best,
           (SELECT count(*) FROM best WHERE best.score > mine.score) + 1 AS rank
    FROM best mine WHERE mine.user_id = ${uid}`;
  return row ? { best: Number(row.best), rank: Number(row.rank) } : { best: null, rank: null };
}
