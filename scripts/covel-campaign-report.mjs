import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';

const dimensions = ['Responsiveness', 'Voice', 'Pacing', 'Specificity'];
const qualitativeTargets = { Responsiveness: 4.9, Pacing: 4.9 };
const dramaticaTargets = { Pacing: 4.5, Voice: 4.8 };
const sha256 = text => createHash('sha256').update(text).digest('hex');
const json = text => JSON.parse(text.replace(/^\uFEFF/u, ''));
const load = async path => json(await readFile(path, 'utf8'));
const key = (profile, number) => profile + ':' + number;
const referenceName = number => 'round-' + String(number).padStart(2, '0');

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
}

function rowsBy(items, property) {
  const groups = new Map();
  for (const row of items) {
    const label = row[property];
    const group = groups.get(label) ?? [];
    group.push(row);
    groups.set(label, group);
  }
  return groups;
}

function countBy(items, label) {
  const counts = {};
  for (const row of items) {
    const name = label(row);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

function summarize(rows, targets) {
  const scores = {};
  const graded = rows.filter(row => row.grade.guardian?.scores);
  for (const type of dimensions) {
    const results = graded.map(row => row.grade.guardian.scores[type]);
    scores[type] = results.length ? Number((results.reduce((sum, result) => sum + result, 0) / results.length).toFixed(3)) : null;
  }
  const arcEvents = rows.flatMap(turn => turn.arcEvents);
  const payoffScenes = rows.flatMap(turn => turn.arcEvents.filter(event => event.stage === 2)
    .map(event => ({ ...event, profile: turn.profile })));
  const saved = rows.filter(turn => turn.saveCount === 1 && turn.actionSaveCount === 1 && turn.checks?.exactlyOneCommit);
  const durations = rows.map(turn => turn.durationMs);
  return {
    turns: rows.length, validGrades: graded.length, meanGuardianScores: scores,
    scoreDistributions: Object.fromEntries(dimensions.map(type => [type, countBy(graded, row => row.grade.guardian.scores[type])])),
    targetsReached: Object.fromEntries(Object.entries(targets).map(([type, target]) =>
      [type, graded.length === rows.length && scores[type] >= target])),
    exactlyOnce: saved.length, uniqueTurns: new Set(rows.map(turn => turn.turnId)).size,
    substantiveTurns: rows.filter(turn => turn.checks?.substantive).length,
    inWordRange: rows.filter(turn => turn.words >= 200 && turn.words <= 300).length,
    minWords: Math.min(...rows.map(turn => turn.words)), maxWords: Math.max(...rows.map(turn => turn.words)),
    p50Ms: percentile(durations, .5), p95Ms: percentile(durations, .95), maxMs: Math.max(...durations),
    p95IncludingRateLimitMs: percentile(rows.map(turn => turn.durationMs + (turn.throttleMs ?? 0)), .95),
    totalRateLimitWaitMs: rows.reduce((sum, turn) => sum + (turn.throttleMs ?? 0), 0),
    slowTurns: rows.filter(turn => turn.durationMs >= 5_000).length,
    providerWaitTurns: rows.filter(turn => turn.providerWaits?.length).length,
    providerWaitsByOperation: countBy(rows.flatMap(turn => turn.providerWaits ?? []), item => item.operation),
    terminalStallTurns: rows.filter(turn => turn.providerStalls?.length).length,
    timingSources: countBy(rows, row => row.timingSource),
    guardianFlags: countBy(graded.flatMap(row => Object.entries(row.grade.guardian.flags)
      .filter(([, outcome]) => outcome !== 'NO')), ([flag, outcome]) => flag + ':' + outcome),
    reusedParagraphs: rows.reduce((total, row) => total + row.grade.reusedParagraphs, 0),
    avenueStages: countBy(arcEvents, event => event.avenueId + '/' + (event.stage + 1) + '/' + event.discovery),
    payoffs: countBy(arcEvents.filter(event => event.stage === 2), event => event.avenueId + '/' + event.discovery),
    distinctCompletedAvenues: new Set(payoffScenes.map(event => key(event.profile, event.avenueId))).size,
    distinctDiscoveredPayoffs: new Set(payoffScenes.filter(event => event.discovery !== 'offstage')
      .map(event => key(event.profile, event.avenueId))).size,
  };
}

function reviewExamples(rows) {
  const groups = [
    ['grounding', row => Object.values(row.grade.guardian?.flags ?? {}).some(flag => flag !== 'NO'), () => 0],
    ['responsiveness', row => Boolean(row.grade.guardian?.scores), row => row.grade.guardian.scores.Responsiveness],
    ['pacing', row => Boolean(row.grade.guardian?.scores), row => row.grade.guardian.scores.Pacing],
    ['voice', row => Boolean(row.grade.guardian?.scores), row => row.grade.guardian.scores.Voice],
  ];
  return Object.fromEntries(groups.map(([type, uses, score]) => {
    const relevant = rows.filter(uses).sort((left, right) => score(left) - score(right)
      || right.grade.reusedParagraphs - left.grade.reusedParagraphs);
    return [type, [...rowsBy(relevant, 'profile').values()].map(group => group[0]).slice(0, 6).map(row => ({
      profile: row.profile, turn: row.campaignTurn, action: row.action, scores: row.grade.guardian.scores,
      flags: row.grade.guardian.flags, finding: row.grade.guardian.finding, prose: row.prose,
    }))];
  }));
}

function eventDelta(turn) {
  const before = new Set((turn.before?.records ?? []).filter(event => event.type === 'pacing-avenue')
    .map(event => key(event.avenueId, event.stage) + '/' + event.discovery));
  return (turn.after?.records ?? []).filter(event => event.type === 'pacing-avenue'
    && !before.has(key(event.avenueId, event.stage) + '/' + event.discovery));
}

async function readRound(directory, round) {
  const name = referenceName(round);
  const raw = await readFile(join(directory, name + '.json'));
  const benchmark = json(raw.toString('utf8'));
  const evaluation = await load(join(directory, name + '-evaluation.json'));
  assert.equal(evaluation.inputSha256, sha256(raw), name + ' has a mismatched evaluation');
  const grades = new Map(evaluation.turns.map(grade => [key(grade.style, grade.turn), grade]));
  const rows = benchmark.styles.flatMap(style => style.turns.map(turn => {
    const id = key(style.id, turn.number);
    const grade = grades.get(id);
    assert.ok(grade, 'Missing NovelOS grade for ' + id);
    grades.delete(id);
    assert.equal(grade.words, turn.words, 'Mismatched manuscript');
    assert.equal(grade.durationMs, turn.durationMs, 'Mismatched timing');
    return { ...turn, grade, profile: style.id, arcEvents: eventDelta(turn) };
  }));
  assert.equal(grades.size, 0, 'Stray grades in ' + name);
  return { rows, fixture: benchmark.fixture, dramatica: Boolean(benchmark.campaign?.campaignFlow), judge: {
    revision: evaluation.novelOSRevision, model: evaluation.guardianModel, rubric: evaluation.rubricSha256,
  } };
}

async function main() {
  const { values } = parseArgs({
    options: { directory: { type: 'string' }, through: { type: 'string' } },
  });
  assert.ok(values.directory, 'Supply --directory and --through');
  const directory = resolve(values.directory);
  const through = Number(values.through);
  assert.ok(Number.isInteger(through) && through >= 1 && through <= 5, 'Choose a round from 1 to 5');
  const rounds = await Promise.all(Array.from({ length: through }, (_, index) => readRound(directory, index + 1)));
  const all = rounds.flatMap(round => round.rows);
  const dramatica = rounds[0].dramatica;
  assert.ok(rounds.every(round => round.dramatica === dramatica), 'Cannot mix campaign editions');
  const targets = dramatica ? dramaticaTargets : qualitativeTargets;
  const profiles = {};
  for (const [id, turns] of rowsBy(all, 'profile')) {
    const legacyFile = join(dirname(directory), 'player-profile-campaign');
    const prior = await load(join(legacyFile, String(Object.keys(profiles).length + 1).padStart(2, '0') + '-' + id + '-evaluation.json'))
      .catch(error => { if (error.code !== 'ENOENT') throw error; });
    profiles[id] = { ...summarize(turns, targets), prior50: prior?.allStyles?.meanGuardianScores ?? null };
  }
  const report = {
    through, fixtures: rounds.some(round => round.fixture), judge: rounds.map(round => round.judge),
    ...(dramatica && { qualitativeTargets: targets }),
    aggregate: summarize(all, targets),
    rounds: rounds.map((round, index) => ({ round: index + 1, ...summarize(round.rows, targets),
      profiles: Object.fromEntries([...rowsBy(round.rows, 'profile')].map(([id, turns]) => [id, summarize(turns, targets)])),
    })),
    profiles, reviewExamples: reviewExamples(rounds.at(-1).rows),
    payoffExamples: [...rowsBy(all.flatMap(turn => turn.arcEvents.filter(event => event.stage === 2 && event.discovery !== 'offstage')
      .map(event => ({
        profile: turn.profile, campaignTurn: turn.campaignTurn, avenueId: event.avenueId, discovery: event.discovery,
        publicSources: (turn.after.observations ?? []).filter(item =>
          item.topic === 'pacing:' + event.avenueId && item.recipients.includes('player')
          && item.passageId === turn.resolved.at(-1)?.id).map(({ title, text, source, status }) => ({ title, text, source, status })),
      }))), 'avenueId').values()].map(turns => turns[0]).slice(0, 12),
  };
  await writeFile(join(directory, 'campaign-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ through, aggregate: report.aggregate, latest: summarize(rounds.at(-1).rows, targets) }));
}

await main();
