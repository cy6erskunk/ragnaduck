import { sql } from '../_lib/db.js';
import { userId } from '../_lib/session.js';

const MAX_STARTS_PER_10_MIN = 30;

// POST /api/runs/start: issues a run ticket. A score can only be posted against a ticket,
// each ticket works once, and the server remembers when it was issued.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const uid = userId(req);
  if (uid == null) return res.status(401).json({ error: 'Sign in to post scores' });
  const [{ n }] = await sql`SELECT count(*) AS n FROM runs WHERE user_id = ${uid} AND started_at > now() - interval '10 minutes'`;
  if (Number(n) >= MAX_STARTS_PER_10_MIN) return res.status(429).json({ error: 'Too many runs. Try again in a few minutes.' });
  await sql`DELETE FROM runs WHERE user_id = ${uid} AND finished_at IS NULL AND started_at < now() - interval '1 day'`;
  const [run] = await sql`INSERT INTO runs (user_id) VALUES (${uid}) RETURNING id`;
  res.status(200).json({ runId: run.id });
}
