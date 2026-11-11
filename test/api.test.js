// Runs the API routes against an in-process Postgres (PGlite) with schema.sql applied,
// and a stand-in for the Neon Auth service behind a mocked global fetch.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const AUTH = 'https://ep-test.neonauth.example/neondb/auth';
const SITE = 'https://duck.example';
process.env.NEON_AUTH_BASE_URL = AUTH;
process.env.NEON_AUTH_COOKIE_SECRET = 'test-secret-test-secret-test-secret-1234';

const { setSqlForTests } = await import('../api/_lib/db.js');
const { cleanName, authConfig } = await import('../api/_lib/auth.js');
const { waveCounts, PTS, minDurationMs } = await import('../api/_lib/rules.js');
const route = async p => (await import(`../api/${p}.js`)).default;

// ---- fake Neon Auth: sessions by cookie token, and a log of what the proxy sent upstream
const accounts = {
  'tok-astrid': { id: 'a1111111-1111-4111-8111-111111111111', name: 'Astrid Larsdottir', email: 'astrid@example.com' },
  'tok-bjorn': { id: 'b2222222-2222-4222-8222-222222222222', name: 'Bjorn', email: 'bjorn@example.com' },
  'tok-loki': { id: 'c3333333-3333-4333-8333-333333333333', name: '', email: 'loki.trickster@example.com' },
};
let upstream = [];
const SESSION = '__Secure-neon-auth.session_token';
const realFetch = globalThis.fetch;
function fakeNeonAuth(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  assert.ok(url.href.startsWith(AUTH), `unexpected outbound request to ${url.href}`);
  const headers = new Headers(init.headers);
  const path = url.pathname.slice(new URL(AUTH).pathname.length);
  upstream.push({ path, search: url.search, method: init.method || 'GET', headers, body: init.body });
  const now = new Date().toISOString(), later = new Date(Date.now() + 86400e3).toISOString();
  if (path === '/get-session') {
    const token = (headers.get('cookie') || '').match(new RegExp(`${SESSION}=([^;]+)`))?.[1];
    const user = accounts[token];
    if (url.searchParams.get('neon_auth_session_verifier') === 'good-verifier' && (headers.get('cookie') || '').includes('session_challenge=chal')) {
      const u = accounts['tok-astrid'];
      const res = Response.json({ session: { id: 's1', token: 'tok-astrid', userId: u.id, expiresAt: later, createdAt: now, updatedAt: now }, user: { ...u, emailVerified: true, createdAt: now, updatedAt: now } });
      res.headers.append('set-cookie', `${SESSION}=tok-astrid; Path=/; HttpOnly; Secure; SameSite=None`);
      return res;
    }
    if (!user) return Response.json(null);
    return Response.json({ session: { id: 's1', token, userId: user.id, expiresAt: later, createdAt: now, updatedAt: now }, user: { ...user, emailVerified: true, createdAt: now, updatedAt: now } });
  }
  if (path === '/sign-in/social') {
    const res = Response.json({ url: 'https://accounts.google.com/o/oauth2/auth?x=1', redirect: true });
    res.headers.append('set-cookie', '__Secure-neon-auth.session_challenge=chal; Path=/; HttpOnly; Secure; SameSite=None');
    res.headers.append('set-cookie', '__Secure-neon-auth.state=st; Path=/; HttpOnly; Secure; Expires=Wed, 01 Jan 2031 00:00:00 GMT');
    return res;
  }
  if (path === '/sign-in/email') return Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }, { status: 401 });
  return Response.json({ message: 'not found' }, { status: 404 });
}

const db = new PGlite();
before(async () => {
  await db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  setSqlForTests(async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
    return (await db.query(text, values)).rows;
  });
  globalThis.fetch = async (input, init) => fakeNeonAuth(input, init);
});
beforeEach(async () => { upstream = []; await db.exec('TRUNCATE runs, players RESTART IDENTITY CASCADE'); });
after(async () => { globalThis.fetch = realFetch; await db.close(); });

// ---- helpers
async function call(path, { method = 'GET', as, cookie, body, origin = SITE, query = '' } = {}) {
  const headers = { host: 'duck.example' };
  if (as) headers.cookie = `${SESSION}=${as}`;
  if (cookie) headers.cookie = cookie;
  if (method !== 'GET' && origin) headers.origin = origin;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const request = new Request(`${SITE}/api/${path}${query}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await (await route(path.split('/').slice(0, path.startsWith('auth') ? 1 : 2).join('/')))['fetch'](request);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, body: data, headers: res.headers, cookies: res.headers.getSetCookie() };
}
const ageRun = (runId, ms) => db.query(`UPDATE runs SET started_at = now() - ($2 || ' milliseconds')::interval WHERE id = $1`, [runId, String(ms)]);

function honest(wave, extra = {}) {
  const kills = {};
  for (let w = 1; w < wave; w++) for (const [t, n] of Object.entries(waveCounts(w))) kills[t] = (kills[t] || 0) + n;
  const total = Object.values(kills).reduce((a, b) => a + b, 0);
  const cleared = wave - 1;
  const score = Object.entries(kills).reduce((a, [t, n]) => a + n * PTS[t], 0) + (kills.elder || 0) * 2000 + 250 * cleared * (cleared + 1) / 2;
  return { score, wave, cleared, kills, eggs: 0, strikes: 0, maxCombo: Math.min(total, 10), durationMs: Math.ceil(minDurationMs(cleared) * 1.5) + 5000, ...extra };
}
async function playRun(as, summary) {
  const start = await call('runs/start', { method: 'POST', as, body: {} });
  assert.equal(start.status, 200);
  await ageRun(start.body.runId, (summary?.durationMs ?? 0) + 3000);
  return call('runs/finish', { method: 'POST', as, body: { runId: start.body.runId, summary } });
}

// ---- sign-in proxy
test('auth proxy: forwards a social sign-in upstream and passes every cookie back', async () => {
  const res = await call('auth', { method: 'POST', query: '?__path=sign-in/social', body: { provider: 'google', callbackURL: `${SITE}/` } });
  assert.equal(res.status, 200);
  assert.equal(res.body.url, 'https://accounts.google.com/o/oauth2/auth?x=1');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.cookies.length, 2);
  assert.ok(res.cookies.some(c => c.startsWith('__Secure-neon-auth.session_challenge=chal')));
  assert.ok(res.cookies.some(c => c.includes('Expires=Wed, 01 Jan 2031')), 'a cookie with a comma in its date survives intact');
  const sent = upstream.at(-1);
  assert.deepEqual([sent.path, sent.method, sent.search], ['/sign-in/social', 'POST', '']);
  assert.deepEqual(JSON.parse(sent.body), { provider: 'google', callbackURL: `${SITE}/` });
  assert.equal(sent.headers.get('origin'), SITE);
});

test('auth proxy: works whether the platform passes the path in the URL or as a rewrite parameter', async () => {
  const handler = await route('auth');
  const direct = await handler.fetch(new Request(`${SITE}/api/auth/sign-in/email`, { method: 'POST', headers: { origin: SITE, 'content-type': 'application/json' }, body: '{"email":"a@b.c","password":"x"}' }));
  assert.equal(direct.status, 401);
  assert.equal((await direct.json()).message, 'Invalid email or password');
  assert.equal(upstream.at(-1).path, '/sign-in/email');
  for (const bad of ['', '../admin', 'sign-in//email', 'a b']) {
    const res = await handler.fetch(new Request(`${SITE}/api/auth?__path=${encodeURIComponent(bad)}`));
    assert.equal(res.status, 404, `path ${JSON.stringify(bad)}`);
  }
  assert.equal((await handler.fetch(new Request(`${SITE}/api/auth/get-session`, { method: 'DELETE' }))).status, 405);
});

test('auth proxy: trades the one-time verifier for a session cookie after a social sign-in', async () => {
  const res = await call('auth', { query: '?__path=get-session&neon_auth_session_verifier=good-verifier', cookie: '__Secure-neon-auth.session_challenge=chal' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'astrid@example.com');
  assert.ok(res.cookies.some(c => c.startsWith(`${SESSION}=tok-astrid`)));
  const sent = upstream.find(u => u.search.includes('good-verifier'));
  assert.ok(sent, 'the verifier reached Neon Auth');
  assert.ok(!sent.search.includes('__path'), 'the rewrite parameter is not leaked upstream');
});

test('auth config needs only what the Vercel-Neon integration provides', async () => {
  const saved = { ...process.env };
  try {
    delete process.env.NEON_AUTH_COOKIE_SECRET;
    process.env.NEON_AUTH_BASE_URL = `${AUTH}/`;
    process.env.DATABASE_URL = 'postgresql://user:pw-one@ep-a.neon.example/neondb';
    const one = authConfig();
    assert.equal(one.baseUrl, AUTH, 'a trailing slash is dropped');
    assert.ok(one.cookieSecret.length >= 32, 'the derived key is long enough for the SDK');
    assert.ok(!one.cookieSecret.includes('pw-one'), 'the database password is not used as-is');
    assert.equal(authConfig().cookieSecret, one.cookieSecret, 'stable across calls');
    process.env.DATABASE_URL = 'postgresql://user:pw-two@ep-b.neon.example/neondb';
    assert.notEqual(authConfig().cookieSecret, one.cookieSecret, 'each environment gets its own key');
    // sign-in still works end to end with the derived key
    const me = await call('me', { as: 'tok-astrid' });
    assert.equal(me.body.user.name, 'Astrid');
    assert.ok(me.cookies.some(c => c.startsWith('__Secure-neon-auth.local.session_data=')));
    // an explicit secret wins; missing variables fail with a clear message
    process.env.NEON_AUTH_COOKIE_SECRET = 'explicit-secret-explicit-secret-123456';
    assert.equal(authConfig().cookieSecret, 'explicit-secret-explicit-secret-123456');
    delete process.env.NEON_AUTH_COOKIE_SECRET; delete process.env.DATABASE_URL;
    assert.throws(authConfig, /DATABASE_URL/);
    delete process.env.NEON_AUTH_BASE_URL;
    assert.throws(authConfig, /NEON_AUTH_BASE_URL/);
  } finally {
    for (const k of ['NEON_AUTH_COOKIE_SECRET', 'NEON_AUTH_BASE_URL', 'DATABASE_URL']) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
});

// ---- accounts and players
test('signed out: /me is empty and score routes refuse', async () => {
  assert.deepEqual((await call('me')).body, { user: null });
  assert.equal((await call('runs/start', { method: 'POST', body: {} })).status, 401);
  assert.equal((await call('runs/finish', { method: 'POST', body: {} })).status, 401);
  assert.equal((await call('runs/start', { method: 'POST', as: 'tok-forged', body: {} })).status, 401);
  assert.equal((await call('me', { method: 'POST', as: 'tok-forged', body: { name: 'Hacker' } })).status, 401);
});

test('state-changing requests from another site are refused', async () => {
  assert.equal((await call('runs/start', { method: 'POST', as: 'tok-astrid', body: {}, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('runs/start', { method: 'POST', as: 'tok-astrid', body: {}, origin: null })).status, 403);
  assert.equal((await call('me', { method: 'PUT', as: 'tok-astrid', body: {} })).status, 405);
});

test('first visit creates a player named after the first word of the account name', async () => {
  const me = await call('me', { as: 'tok-astrid' });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.user, { id: 1, name: 'Astrid' });
  assert.equal(me.body.stats.runs, 0);
  assert.ok(me.cookies.some(c => c.startsWith('__Secure-neon-auth.local.session_data=')), 'the session cache cookie is passed along');
  // an account with no name falls back to the email's local part
  assert.equal((await call('me', { as: 'tok-loki' })).body.user.name, 'loki.trickster');
  await call('me', { as: 'tok-astrid' });
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM players')).rows[0].n), 2);
});

test('players can rename themselves; bad names are refused', async () => {
  const ok = await call('me', { method: 'POST', as: 'tok-astrid', body: { name: '  Astrid   the\u0000 Bold  ' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.name, 'Astrid the Bold');
  assert.equal((await call('me', { as: 'tok-astrid' })).body.user.name, 'Astrid the Bold');
  for (const name of ['', ' ', 'x', 42, null]) assert.equal((await call('me', { method: 'POST', as: 'tok-astrid', body: { name } })).status, 400);
  assert.equal(cleanName('a'.repeat(40)).length, 24);
});

// ---- runs
test('a valid run is recorded and ranked; its ticket cannot be reused', async () => {
  const summary = honest(6);
  const start = await call('runs/start', { method: 'POST', as: 'tok-astrid', body: {} });
  await ageRun(start.body.runId, summary.durationMs + 3000);
  const fin = await call('runs/finish', { method: 'POST', as: 'tok-astrid', body: { runId: start.body.runId, summary } });
  assert.equal(fin.status, 200);
  assert.deepEqual(fin.body, { ok: true, score: summary.score, best: summary.score, rank: 1, personalBest: true });
  const again = await call('runs/finish', { method: 'POST', as: 'tok-astrid', body: { runId: start.body.runId, summary } });
  assert.equal(again.status, 409);
  const me = await call('me', { as: 'tok-astrid' });
  assert.deepEqual([me.body.stats.best, me.body.stats.bestWave, me.body.stats.runs], [summary.score, 6, 1]);
});

test('a ticket belongs to the player who started the run', async () => {
  const summary = honest(3);
  const start = await call('runs/start', { method: 'POST', as: 'tok-astrid', body: {} });
  await ageRun(start.body.runId, summary.durationMs + 3000);
  const stolen = await call('runs/finish', { method: 'POST', as: 'tok-bjorn', body: { runId: start.body.runId, summary } });
  assert.equal(stolen.status, 409);
});

test('fake results are rejected, kept for review, and never shown', async () => {
  // a fresh ticket submitted at once with a deep run: no time has passed on the server
  const start = await call('runs/start', { method: 'POST', as: 'tok-loki', body: {} });
  const instant = await call('runs/finish', { method: 'POST', as: 'tok-loki', body: { runId: start.body.runId, summary: honest(20) } });
  assert.equal(instant.status, 422);
  assert.deepEqual(instant.body, { error: 'Run rejected' });
  assert.equal((await playRun('tok-loki', honest(5, { score: 5_000_000 }))).status, 422);
  assert.equal((await playRun('tok-loki', 'lol')).status, 422);
  assert.equal((await call('runs/finish', { method: 'POST', as: 'tok-loki', body: { runId: 'nope', summary: honest(2) } })).status, 400);

  const flagged = (await db.query('SELECT flagged FROM runs')).rows.map(r => r.flagged).sort();
  assert.deepEqual(flagged, ['duration>elapsed', 'score-high', 'shape']);
  assert.deepEqual((await call('leaderboard')).body.rows, []);
  assert.equal((await call('me', { as: 'tok-loki' })).body.stats.best, null);
});

test('leaderboard shows each player once at their best, hides banned players, and filters by week', async () => {
  assert.equal((await playRun('tok-astrid', honest(4))).body.rank, 1);
  assert.equal((await playRun('tok-bjorn', honest(9))).body.rank, 1);
  const better = await playRun('tok-astrid', honest(7));
  assert.deepEqual([better.body.rank, better.body.personalBest], [2, true]);
  const worse = await playRun('tok-astrid', honest(2));
  assert.deepEqual([worse.body.rank, worse.body.personalBest, worse.body.best], [2, false, honest(7).score]);
  await playRun('tok-loki', honest(12));
  await db.query(`UPDATE players SET banned = true WHERE name = 'loki.trickster'`);

  const board = await call('leaderboard');
  assert.deepEqual(board.body.rows.map(r => [r.rank, r.name, r.wave]), [[1, 'Bjorn', 9], [2, 'Astrid', 7]]);
  assert.match(board.headers.get('cache-control'), /s-maxage=15/);
  assert.ok(!JSON.stringify(board.body).includes('@'), 'no email addresses on the public board');
  assert.ok(!JSON.stringify(board.body).includes('Larsdottir'), 'no full account names on the public board');
  assert.equal((await call('me', { as: 'tok-astrid' })).body.stats.rank, 2);

  await db.query(`UPDATE runs SET finished_at = now() - interval '10 days' WHERE player_id = (SELECT id FROM players WHERE name = 'Bjorn')`);
  const week = (await call('leaderboard', { query: '?period=week' })).body;
  assert.equal(week.period, 'week');
  assert.deepEqual(week.rows.map(r => r.name), ['Astrid']);
});

test('starting runs is rate limited', async () => {
  for (let i = 0; i < 30; i++) assert.equal((await call('runs/start', { method: 'POST', as: 'tok-bjorn', body: {} })).status, 200);
  assert.equal((await call('runs/start', { method: 'POST', as: 'tok-bjorn', body: {} })).status, 429);
});
