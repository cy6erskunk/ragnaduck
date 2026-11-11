// Server-side copy of the game rules that decide whether a submitted run is plausible.
// PTS and waveCounts must match TYPES and waveMix in index.html; test/rules.test.js
// reads index.html and fails if they drift apart.

export const PTS = { duck: 100, duckling: 50, mallard: 200, bomber: 150, goose: 250, diver: 200, spitter: 200, elder: 3000 };

const ELDER_BONUS = 2000;   // extra points for felling an Elder Drake
const STRIKE_BONUS = 500;   // a corpse that bowls over three ducks
const EGG_BONUS = 1000;     // golden egg pickup
const CLEAR_BONUS = 250;    // times the wave number, for each cleared wave
const MAX_WAVE = 500;
const MAX_ELAPSED_MS = 6 * 3600e3;

/** How many ducks of each type wave `w` spawns. */
export function waveCounts(w) {
  const c = {};
  const add = (t, n) => { if (n > 0) c[t] = (c[t] || 0) + n; };
  if (w % 5 === 0) { add('elder', Math.floor(w / 5)); add('duck', 4 + w); add('duckling', w); add('spitter', Math.floor(w / 3)); if (w >= 10) add('bomber', 4); }
  else if (w === 7 || (w > 10 && w % 4 === 3)) { add('duckling', 22 + w * 3); add('duck', 4); add('spitter', Math.floor(w / 3)); }
  else if (w === 9 || (w > 10 && w % 4 === 1)) { add('bomber', 9 + w); add('duck', w); add('goose', 2); add('spitter', 3); }
  else {
    add('duck', 5 + Math.round(w * 2.5));
    if (w >= 2) add('duckling', w * 2);
    if (w >= 3) add('bomber', Math.ceil(w / 2));
    if (w >= 4) add('spitter', Math.max(2, Math.floor(w / 2)));
    if (w >= 6) add('goose', Math.max(1, Math.floor(w / 3)));
    if (w >= 8) add('diver', Math.floor(w / 2));
    if (w >= 3) add('mallard', Math.floor(w / 3));
  }
  return c;
}

/**
 * The least play time needed to clear the first `cleared` waves. Ducks leave the spawn
 * queue one at a time (ducklings up to three at once) on a fixed timer, and every wave
 * has fixed pauses around it, so no amount of skill gets under this.
 */
export function minDurationMs(cleared) {
  let s = 0;
  for (let w = 1; w <= cleared; w++) {
    const c = waveCounts(w);
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    const ducklings = c.duckling || 0;
    const spawns = total - ducklings + Math.ceil(ducklings / 3);
    s += 0.4 + (spawns - 1) * Math.max(0.2, 1.0 - w * 0.065) + 1.8 + 1.0;
  }
  return s * 1000;
}

const isCount = n => Number.isSafeInteger(n) && n >= 0;

/**
 * Checks a run summary sent by the game against what the rules allow.
 * `elapsedMs` is the time between the server issuing the run ticket and receiving
 * this summary, measured by the server.
 * Returns {ok: true, kills} or {ok: false, reason}.
 */
export function validateRun(s, elapsedMs) {
  const fail = reason => ({ ok: false, reason });
  if (!s || typeof s !== 'object') return fail('shape');
  for (const k of ['score', 'wave', 'cleared', 'eggs', 'strikes', 'maxCombo', 'durationMs']) {
    if (!isCount(s[k])) return fail(`shape:${k}`);
  }
  if (!s.kills || typeof s.kills !== 'object' || Array.isArray(s.kills)) return fail('shape:kills');
  let kills = 0;
  for (const [t, n] of Object.entries(s.kills)) {
    if (!Object.hasOwn(PTS, t) || !isCount(n)) return fail('shape:kills');
    kills += n;
  }
  if (s.wave < 1 || s.wave > MAX_WAVE) return fail('wave');
  if (s.cleared !== s.wave && s.cleared !== s.wave - 1) return fail('cleared');

  // Time: the run cannot be longer than the ticket has existed, nor shorter than the spawn timers allow.
  if (elapsedMs > MAX_ELAPSED_MS) return fail('stale');
  if (s.durationMs > elapsedMs + 10e3) return fail('duration>elapsed');
  if (s.durationMs < minDurationMs(s.cleared) * 0.9) return fail('too-fast');

  // Kills: every duck of a cleared wave must have been felled, and nothing beyond the current wave can have been.
  const lo = {}, hi = {};
  for (let w = 1; w <= s.wave; w++) {
    for (const [t, n] of Object.entries(waveCounts(w))) {
      hi[t] = (hi[t] || 0) + n;
      if (w <= s.cleared) lo[t] = (lo[t] || 0) + n;
    }
  }
  // Elder Drakes lay extra ducklings: at most one clutch of (3 + wave/5) every 4 seconds per Drake.
  const drakes = Math.floor(s.wave / 5);
  const laid = Math.floor(s.durationMs / 1000 * drakes * (3 + drakes) / 4);
  let base = 0;
  for (const t of Object.keys(PTS)) {
    const n = s.kills[t] || 0;
    // Kaboom Ducks that blow themselves up are not counted as kills, so they have no lower bound.
    if (t !== 'bomber' && n < (lo[t] || 0)) return fail(`kills-low:${t}`);
    if (n > (hi[t] || 0) + (t === 'duckling' ? laid : 0)) return fail(`kills-high:${t}`);
    base += n * PTS[t];
  }
  if (s.maxCombo > kills) return fail('combo');
  if (s.strikes > kills) return fail('strikes');
  if (s.eggs > 5 + kills * 0.2) return fail('eggs');

  // Score: each kill is worth its base points times a combo multiplier of at most 1 + maxCombo/10
  // (rounded to the nearest 10), and the bonuses are fixed amounts.
  const bonus = (s.kills.elder || 0) * ELDER_BONUS + s.strikes * STRIKE_BONUS + s.eggs * EGG_BONUS
    + CLEAR_BONUS * s.cleared * (s.cleared + 1) / 2;
  if (s.score < base + bonus) return fail('score-low');
  if (s.score > base * (1 + s.maxCombo / 10) + 5 * kills + bonus) return fail('score-high');
  return { ok: true, kills };
}
