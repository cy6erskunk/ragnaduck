import { sql } from '../_lib/db.js';
import { currentPlayer } from '../_lib/auth.js';
import { json, route } from '../_lib/http.js';

const MAX_STARTS_PER_10_MIN = 30;

// POST /api/runs/start: issues a run ticket. A score can only be posted against a ticket,
// each ticket works once, and the server remembers when it was issued.
export default route({
  async POST(request) {
    const { player, cookies } = await currentPlayer(request);
    if (!player) return json({ error: 'Sign in to post scores' }, 401);
    const [{ n }] = await sql`SELECT count(*) AS n FROM runs WHERE player_id = ${player.id} AND started_at > now() - interval '10 minutes'`;
    if (Number(n) >= MAX_STARTS_PER_10_MIN) return json({ error: 'Too many runs. Try again in a few minutes.' }, 429, { cookies });
    await sql`DELETE FROM runs WHERE player_id = ${player.id} AND finished_at IS NULL AND started_at < now() - interval '1 day'`;
    const [run] = await sql`INSERT INTO runs (player_id) VALUES (${player.id}) RETURNING id`;
    return json({ runId: run.id }, 200, { cookies });
  },
});
