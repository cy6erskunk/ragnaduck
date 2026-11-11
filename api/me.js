import { sql } from './_lib/db.js';
import { currentPlayer, cleanName } from './_lib/auth.js';
import { standing } from './_lib/board.js';
import { json, readJson, route } from './_lib/http.js';

async function profile(player, cookies) {
  const [t] = await sql`
    SELECT count(*) AS runs, coalesce(sum(kills), 0) AS kills, coalesce(max(wave), 0) AS wave,
           coalesce(max(max_combo), 0) AS combo, coalesce(sum(duration_ms), 0) AS ms
    FROM runs WHERE player_id = ${player.id} AND flagged IS NULL AND score IS NOT NULL`;
  const { best, rank } = await standing(player.id);
  return json({
    user: { id: player.id, name: player.name },
    stats: {
      best, rank, runs: Number(t.runs), kills: Number(t.kills), bestWave: Number(t.wave),
      bestCombo: Number(t.combo), minutes: Math.round(Number(t.ms) / 60000),
    },
  }, 200, { cookies });
}

export default route({
  // GET /api/me: who is signed in, with their stats. {user: null} when signed out.
  async GET(request) {
    const { player, cookies } = await currentPlayer(request);
    return player ? profile(player, cookies) : json({ user: null });
  },
  // POST /api/me {name}: change the display name shown on the leaderboard.
  async POST(request) {
    const { player, cookies } = await currentPlayer(request);
    if (!player) return json({ error: 'Sign in first' }, 401);
    const name = cleanName((await readJson(request)).name);
    if (!name) return json({ error: 'Names need 2 to 24 characters' }, 400, { cookies });
    await sql`UPDATE players SET name = ${name} WHERE id = ${player.id}`;
    return profile({ ...player, name }, cookies);
  },
});
