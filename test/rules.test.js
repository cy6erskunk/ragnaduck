import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PTS, waveCounts, minDurationMs, validateRun } from '../api/_lib/rules.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('server duck points match the game', () => {
  const block = html.match(/const TYPES = \{([\s\S]*?)\n\};/)[1];
  const client = Object.fromEntries([...block.matchAll(/^\s*(\w+):\s*\{.*?pts: (\d+)/gm)].map(m => [m[1], Number(m[2])]));
  assert.deepEqual(client, PTS);
});

test('server wave contents match the game for waves 1-60', () => {
  const src = html.match(/function waveMix\(w\) \{[\s\S]*?\n\}/)[0];
  const waveMix = new Function(`${src}; return waveMix;`)();
  for (let w = 1; w <= 60; w++) {
    const client = {};
    for (const t of waveMix(w)) client[t] = (client[t] || 0) + 1;
    assert.deepEqual(client, waveCounts(w), `wave ${w}`);
  }
});

// An honest run that died during `wave` with every earlier wave cleared and no combos.
function honest(wave, extra = {}) {
  const kills = {};
  for (let w = 1; w < wave; w++) for (const [t, n] of Object.entries(waveCounts(w))) kills[t] = (kills[t] || 0) + n;
  const base = Object.entries(kills).reduce((a, [t, n]) => a + n * PTS[t], 0);
  const cleared = wave - 1;
  const score = base + (kills.elder || 0) * 2000 + 250 * cleared * (cleared + 1) / 2;
  const durationMs = Math.ceil(minDurationMs(cleared) * 1.5) + 5000;
  return { score, wave, cleared, kills, eggs: 0, strikes: 0, maxCombo: 0, durationMs, ...extra };
}
const check = (s, elapsed = s.durationMs + 2000) => validateRun(s, elapsed);

test('accepts honest runs', () => {
  for (const wave of [1, 2, 5, 6, 11, 26]) assert.equal(check(honest(wave)).ok, true, `wave ${wave}`);
});

test('accepts combo and bonus points within the rules', () => {
  const s = honest(8);
  const total = Object.values(s.kills).reduce((a, b) => a + b, 0);
  s.maxCombo = 20; s.eggs = 2; s.strikes = 3;
  s.score += 2 * 1000 + 3 * 500 + Math.floor(total * 100 * 0.9);
  assert.equal(check(s).ok, true);
});

test('rejects malformed summaries', () => {
  assert.equal(validateRun(null, 1e6).reason, 'shape');
  assert.equal(check(honest(3, { score: -5 })).reason, 'shape:score');
  assert.equal(check(honest(3, { score: 1e30 })).reason, 'shape:score');
  assert.equal(check(honest(3, { kills: { dragon: 5 } })).reason, 'shape:kills');
  assert.equal(check(honest(3, { wave: 0, cleared: 0 })).reason, 'wave');
  assert.equal(check(honest(3, { cleared: 0 })).reason, 'cleared');
});

test('rejects a made-up high score', () => {
  assert.equal(check(honest(4, { score: 9_999_990 })).reason, 'score-high');
});

test('rejects a score lower than the kills are worth', () => {
  const s = honest(6);
  assert.equal(check({ ...s, score: s.score - 500 }).reason, 'score-low');
});

test('rejects a run finished faster than the spawn timers allow', () => {
  const s = honest(20);
  assert.equal(check({ ...s, durationMs: 60_000 }, 62_000).reason, 'too-fast');
});

test('rejects a run longer than its ticket has existed', () => {
  const s = honest(10);
  assert.equal(validateRun(s, s.durationMs - 60_000).reason, 'duration>elapsed');
});

test('rejects more kills than the waves contain', () => {
  const s = honest(5);
  s.kills.mallard = 500; s.score += 495 * 200;
  assert.match(check(s).reason, /^kills-high:mallard/);
});

test('rejects a deep wave without the kills to get there', () => {
  const s = honest(15);
  s.kills.duck -= 30; s.score -= 30 * 100;
  assert.match(check(s).reason, /^kills-low:duck/);
});

test('rejects a combo longer than the kill count', () => {
  const s = honest(2);
  const total = Object.values(s.kills).reduce((a, b) => a + b, 0);
  assert.equal(check({ ...s, maxCombo: total + 1 }).reason, 'combo');
});
