// Runs the API routes against an in-process Postgres (PGlite) with schema.sql applied.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.GITHUB_CLIENT_ID = 'client-id';
process.env.GITHUB_CLIENT_SECRET = 'client-secret';

const { setSqlForTests } = await import('../api/_lib/db.js');
const { signSession, readSession, SESSION_COOKIE, STATE_COOKIE } = await import('../api/_lib/session.js');
const { waveCounts, PTS, minDurationMs } = await import('../api/_lib/rules.js');
const route = async p => (await import(`../api/${p}.js`)).default;

const db = new PGlite();
const realFetch = globalThis.fetch;
before(async () => {
  await db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  setSqlForTests(async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
    return (await db.query(text, values)).rows;
  });
});
beforeEach(async () => { await db.exec('TRUNCATE runs, users RESTART IDENTITY CASCADE'); });
after(async () => { globalThis.fetch = realFetch; await db.close(); });

// Minimal stand-ins for Vercel's Node request and response helpers.
async function call(path, { method = 'GET', cookies = {}, query = {}, body } = {}) {
  const out = { status: 200, headers: {}, body: undefined, redirect: null };
  const res = {
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; return res; },
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; return res; },
    send(b) { out.body = b; return res; },
    redirect(c, url) { out.status = c; out.redirect = url; return res; },
  };
  const req = { method, cookies, query, body, headers: { host: 'duck.example', 'x-forwarded-proto': 'https' } };
  await (await route(path))(req, res);
  return out;
}
const addUser = async (name, githubId) => Number((await db.query('INSERT INTO users (github_id, name) VALUES ($1, $2) RETURNING id', [githubId, name])).rows[0].id);
const as = uid => ({ [SESSION_COOKIE]: signSession(uid) });
const ageRun = (runId, ms) => db.query(`UPDATE runs SET started_at = now() - ($2 || ' milliseconds')::interval WHERE id = $1`, [runId, String(ms)]);

function honest(wave, bonusScore = 0) {
  const kills = {};
  for (let w = 1; w < wave; w++) for (const [t, n] of Object.entries(waveCounts(w))) kills[t] = (kills[t] || 0) + n;
  const total = Object.values(kills).reduce((a, b) => a + b, 0);
  const cleared = wave - 1;
  const score = Object.entries(kills).reduce((a, [t, n]) => a + n * PTS[t], 0) + (kills.elder || 0) * 2000 + 250 * cleared * (cleared + 1) / 2 + bonusScore;
  return { score, wave, cleared, kills, eggs: 0, strikes: 0, maxCombo: Math.min(total, 10), durationMs: Math.ceil(minDurationMs(cleared) * 1.5) + 5000 };
}
async function playRun(uid, summary) {
  const start = await call('runs/start', { method: 'POST', cookies: as(uid), body: {} });
  assert.equal(start.status, 200);
  await ageRun(start.body.runId, (summary.durationMs ?? 0) + 3000);
  return call('runs/finish', { method: 'POST', cookies: as(uid), body: { runId: start.body.runId, summary } });
}

test('sessions: a signed cookie reads back, a tampered or expired one does not', () => {
  const token = signSession(42);
  assert.equal(readSession(token), 42);
  const forged = Buffer.from(JSON.stringify({ uid: 1, exp: Date.now() + 1e9 })).toString('base64url') + '.' + token.split('.')[1];
  assert.equal(readSession(forged), null);
  assert.equal(readSession(token, Date.now() + 31 * 86400e3), null);
  assert.equal(readSession('garbage'), null);
});

test('signed out: /me is empty and score routes refuse', async () => {
  assert.deepEqual((await call('me')).body, { user: null });
  assert.equal((await call('runs/start', { method: 'POST', body: {} })).status, 401);
  assert.equal((await call('runs/finish', { method: 'POST', body: {} })).status, 401);
  assert.equal((await call('runs/start', { method: 'POST', cookies: { [SESSION_COOKIE]: 'x.y' }, body: {} })).status, 401);
});

test('GitHub sign-in: login redirects with a state, callback creates the user and a session', async () => {
  const login = await call('auth/login');
  assert.equal(login.status, 302);
  const url = new URL(login.redirect);
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://duck.example/api/auth/callback');
  const state = url.searchParams.get('state');
  assert.match(login.headers['set-cookie'], new RegExp(`^${STATE_COOKIE}=${state}; .*HttpOnly; Secure; SameSite=Lax`));

  globalThis.fetch = async (u, init) => {
    if (String(u).includes('access_token')) {
      assert.equal(JSON.parse(init.body).code, 'the-code');
      return { ok: true, json: async () => ({ access_token: 'gho_x' }) };
    }
    assert.equal(init.headers.authorization, 'Bearer gho_x');
    return { ok: true, json: async () => ({ id: 583231, login: 'octocat', avatar_url: 'https://avatars.example/1' }) };
  };
  const bad = await call('auth/callback', { query: { code: 'the-code', state: 'other' }, cookies: { [STATE_COOKIE]: state } });
  assert.equal(bad.status, 400);
  const cb = await call('auth/callback', { query: { code: 'the-code', state }, cookies: { [STATE_COOKIE]: state } });
  assert.equal(cb.status, 302);
  assert.equal(cb.redirect, '/');
  const session = cb.headers['set-cookie'][0].match(new RegExp(`^${SESSION_COOKIE}=([^;]+)`))[1];
  const me = await call('me', { cookies: { [SESSION_COOKIE]: session } });
  assert.equal(me.body.user.name, 'octocat');
  assert.equal(me.body.stats.runs, 0);
  // signing in again updates the same user rather than adding one
  await call('auth/callback', { query: { code: 'the-code', state }, cookies: { [STATE_COOKIE]: state } });
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM users')).rows[0].n), 1);
});

test('a valid run is recorded and ranked; its ticket cannot be reused', async () => {
  const uid = await addUser('astrid', 1);
  const summary = honest(6);
  const start = await call('runs/start', { method: 'POST', cookies: as(uid), body: {} });
  await ageRun(start.body.runId, summary.durationMs + 3000);
  const fin = await call('runs/finish', { method: 'POST', cookies: as(uid), body: { runId: start.body.runId, summary } });
  assert.equal(fin.status, 200);
  assert.deepEqual(fin.body, { ok: true, score: summary.score, best: summary.score, rank: 1, personalBest: true });
  const again = await call('runs/finish', { method: 'POST', cookies: as(uid), body: { runId: start.body.runId, summary } });
  assert.equal(again.status, 409);
  const me = await call('me', { cookies: as(uid) });
  assert.equal(me.body.stats.best, summary.score);
  assert.equal(me.body.stats.bestWave, 6);
  assert.equal(me.body.stats.runs, 1);
});

test('a ticket belongs to the player who started the run', async () => {
  const a = await addUser('astrid', 1), b = await addUser('bjorn', 2);
  const summary = honest(3);
  const start = await call('runs/start', { method: 'POST', cookies: as(a), body: {} });
  await ageRun(start.body.runId, summary.durationMs + 3000);
  const stolen = await call('runs/finish', { method: 'POST', cookies: as(b), body: { runId: start.body.runId, summary } });
  assert.equal(stolen.status, 409);
});

test('fake results are rejected, kept for review, and never shown', async () => {
  const uid = await addUser('loki', 3);
  // a fresh ticket submitted at once with a deep run: no time has passed on the server
  const start = await call('runs/start', { method: 'POST', cookies: as(uid), body: {} });
  const instant = await call('runs/finish', { method: 'POST', cookies: as(uid), body: { runId: start.body.runId, summary: honest(20) } });
  assert.equal(instant.status, 422);
  assert.deepEqual(instant.body, { error: 'Run rejected' });
  // enough time, but an invented score
  const inflated = await playRun(uid, { ...honest(5), score: 5_000_000 });
  assert.equal(inflated.status, 422);
  // junk
  const junk = await playRun(uid, 'lol');
  assert.equal(junk.status, 422);
  const noTicket = await call('runs/finish', { method: 'POST', cookies: as(uid), body: { runId: 'nope', summary: honest(2) } });
  assert.equal(noTicket.status, 400);

  const flagged = (await db.query('SELECT flagged FROM runs ORDER BY started_at')).rows.map(r => r.flagged).sort();
  assert.deepEqual(flagged, ['duration>elapsed', 'score-high', 'shape']);
  assert.deepEqual((await call('leaderboard')).body.rows, []);
  assert.equal((await call('me', { cookies: as(uid) })).body.stats.best, null);
});

test('leaderboard shows each player once at their best, hides banned players, and filters by week', async () => {
  const a = await addUser('astrid', 1), b = await addUser('bjorn', 2), c = await addUser('cheater', 3);
  assert.equal((await playRun(a, honest(4))).body.rank, 1);
  const top = await playRun(b, honest(9));
  assert.equal(top.body.rank, 1);
  const better = await playRun(a, honest(7));
  assert.deepEqual([better.body.rank, better.body.personalBest], [2, true]);
  const worse = await playRun(a, honest(2));
  assert.deepEqual([worse.body.rank, worse.body.personalBest, worse.body.best], [2, false, honest(7).score]);
  await playRun(c, honest(12));
  await db.query('UPDATE users SET banned = true WHERE id = $1', [c]);

  const all = (await call('leaderboard')).body.rows;
  assert.deepEqual(all.map(r => [r.rank, r.name, r.wave]), [[1, 'bjorn', 9], [2, 'astrid', 7]]);
  assert.equal((await call('me', { cookies: as(a) })).body.stats.rank, 2);

  await db.query(`UPDATE runs SET finished_at = now() - interval '10 days' WHERE user_id = $1`, [b]);
  const week = (await call('leaderboard', { query: { period: 'week' } })).body;
  assert.equal(week.period, 'week');
  assert.deepEqual(week.rows.map(r => r.name), ['astrid']);
});

test('starting runs is rate limited', async () => {
  const uid = await addUser('spammer', 9);
  for (let i = 0; i < 30; i++) assert.equal((await call('runs/start', { method: 'POST', cookies: as(uid), body: {} })).status, 200);
  assert.equal((await call('runs/start', { method: 'POST', cookies: as(uid), body: {} })).status, 429);
});

test('logout clears the session cookie', async () => {
  const out = await call('auth/logout', { method: 'POST' });
  assert.match(out.headers['set-cookie'], new RegExp(`^${SESSION_COOKIE}=; .*Max-Age=0`));
  assert.equal((await call('auth/logout')).status, 405);
});
