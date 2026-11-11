import { sql } from '../_lib/db.js';
import { currentPlayer } from '../_lib/auth.js';
import { validateRun } from '../_lib/rules.js';
import { standing } from '../_lib/board.js';
import { json, readJson, route } from '../_lib/http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/runs/finish {runId, summary}: closes a run ticket and records the result.
// The summary is checked against the game rules; a run that fails is stored with the
// reason in `flagged` and never reaches the leaderboard.
export default route({
  async POST(request) {
    const { player, cookies } = await currentPlayer(request);
    if (!player) return json({ error: 'Sign in to post scores' }, 401);
    const { runId, summary } = await readJson(request);
    if (typeof runId !== 'string' || !UUID.test(runId)) return json({ error: 'Bad run ticket' }, 400, { cookies });

    // Closing the ticket and reading its age in one statement makes it single-use.
    const [run] = await sql`
      UPDATE runs SET finished_at = now()
      WHERE id = ${runId} AND player_id = ${player.id} AND finished_at IS NULL
      RETURNING extract(epoch FROM now() - started_at) * 1000 AS elapsed_ms`;
    if (!run) return json({ error: 'This run was already posted or does not exist' }, 409, { cookies });

    const verdict = validateRun(summary, Number(run.elapsed_ms));
    if (!verdict.ok) {
      const kept = JSON.stringify(summary ?? null).slice(0, 4000);
      await sql`UPDATE runs SET flagged = ${verdict.reason}, summary = ${JSON.stringify({ rejected: kept })}::jsonb WHERE id = ${runId}`;
      return json({ error: 'Run rejected' }, 422, { cookies });
    }
    const before = await standing(player.id);
    await sql`
      UPDATE runs SET score = ${summary.score}, wave = ${summary.wave}, kills = ${verdict.kills},
        max_combo = ${summary.maxCombo}, duration_ms = ${summary.durationMs}, summary = ${JSON.stringify(summary)}::jsonb
      WHERE id = ${runId}`;
    const after = await standing(player.id);
    return json({ ok: true, score: summary.score, best: after.best, rank: after.rank, personalBest: before.best == null || summary.score > before.best }, 200, { cookies });
  },
});
