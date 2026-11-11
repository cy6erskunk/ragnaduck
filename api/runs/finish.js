import { sql } from '../_lib/db.js';
import { userId } from '../_lib/session.js';
import { validateRun } from '../_lib/rules.js';
import { standing } from '../_lib/board.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/runs/finish {runId, summary}: closes a run ticket and records the result.
// The summary is checked against the game rules; a run that fails is stored with the
// reason in `flagged` and never reaches the leaderboard.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const uid = userId(req);
  if (uid == null) return res.status(401).json({ error: 'Sign in to post scores' });
  const { runId, summary } = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof runId !== 'string' || !UUID.test(runId)) return res.status(400).json({ error: 'Bad run ticket' });

  // Closing the ticket and reading its age in one statement makes it single-use.
  const [run] = await sql`
    UPDATE runs SET finished_at = now()
    WHERE id = ${runId} AND user_id = ${uid} AND finished_at IS NULL
    RETURNING extract(epoch FROM now() - started_at) * 1000 AS elapsed_ms`;
  if (!run) return res.status(409).json({ error: 'This run was already posted or does not exist' });

  const verdict = validateRun(summary, Number(run.elapsed_ms));
  if (!verdict.ok) {
    const kept = JSON.stringify(summary ?? null).slice(0, 4000);
    await sql`UPDATE runs SET flagged = ${verdict.reason}, summary = ${JSON.stringify({ rejected: kept })}::jsonb WHERE id = ${runId}`;
    return res.status(422).json({ error: 'Run rejected' });
  }
  const before = await standing(uid);
  await sql`
    UPDATE runs SET score = ${summary.score}, wave = ${summary.wave}, kills = ${verdict.kills},
      max_combo = ${summary.maxCombo}, duration_ms = ${summary.durationMs}, summary = ${JSON.stringify(summary)}::jsonb
    WHERE id = ${runId}`;
  const after = await standing(uid);
  res.status(200).json({ ok: true, score: summary.score, best: after.best, rank: after.rank, personalBest: before.best == null || summary.score > before.best });
}
