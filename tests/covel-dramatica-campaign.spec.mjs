import { expect, test } from '@playwright/test';
import { campaignStart } from '../app/campaign.mjs';
import { playerView, startEpisode, title } from '../app/episode.mjs';
import { actorContext } from '../app/knowledge.mjs';
import { resolveTurn } from '../app/turns.mjs';

function start(options) {
  return { id: 'dramatic-campaign', name: title, revision: 0, state: startEpisode(options) };
}

async function play(save, label) {
  const result = await resolveTurn(save, label);
  expect(result.clarification, label).toBeUndefined();
  return { ...save, revision: save.revision + 1, state: result.state };
}

const options = save => playerView(save).campaign.options;
const choose = (save, stance) => play(save, options(save).find(item => item.stance === stance).label);
const beat = save => save.state.records.findLast(record => record.dramaticBeat);

test('Dramatica starts in a live conflict and each action reveals, decides, or changes what can go ahead', async () => {
  let save = start({ campaign: true, dramatica: true });
  expect(save.state.campaign).toMatchObject({ dramatica: true, chapter: 1 });
  expect(playerView(save)).toMatchObject({ scene: { id: 'campaign', heading: 'The work before breakfast' }, campaign: { step: 1 } });
  expect(save.state.passages).toHaveLength(1);

  const initial = beat(save);
  save = await choose(save, 'verify');
  expect(playerView(save).campaign.step).toBe(3);
  const revealed = beat(save);
  expect(revealed).toMatchObject({ step: 1, dramaticBeat: { kind: 'reveal', cause: initial.dramaticBeat.effect } });

  save.state = JSON.parse(JSON.stringify(save.state));
  save = await choose(save, 'verify');
  const decided = beat(save);
  expect(save.state.campaign.step).toBe(5);
  expect(decided).toMatchObject({ step: 3, outcome: 'verified', dramaticBeat: {
    kind: 'decision', cause: revealed.dramaticBeat.effect, effect: expect.stringContaining('Alice sets the tally out'),
  } });

  const nextOptions = options(save);
  expect(nextOptions).toHaveLength(2);
  expect(nextOptions.map(item => item.arrival)).toEqual(['verify', 'help']);
  save = await play(save, nextOptions[1].label);
  expect(save.state.campaign).toMatchObject({ chapter: 2, caseId: nextOptions[1].caseId, step: 3, evidence: 'reported' });
  const opened = save.state.records.findLast(record => record.type === 'campaign-opened');
  expect(opened.dramaticBeat).toMatchObject({ kind: 'setup', cause: decided.dramaticBeat.effect });
  expect(beat(save).dramaticBeat).toMatchObject({ kind: 'reveal', cause: opened.dramaticBeat.effect });
  expect(save.state.passages).toHaveLength(5);
  expect(save.state.passages.at(-2).playerText).toBeNull();
  expect(save.state.passages.at(-1).playerText).toBe(nextOptions[1].label);
  expect(save.state.passages.at(-1).paragraphs).toEqual([expect.stringMatching(/reports that .* Those details are their account/u)]);

  for (const record of [initial, revealed, decided, opened, beat(save)]) {
    const { effect, speakerId, sourceIds } = record.dramaticBeat;
    const passage = save.state.passages.find(item => item.id === record.passageId);
    expect(passage.actorIds).toContain(speakerId);
    expect(sourceIds.some(id => save.state.observations.some(item => item.id === id && item.text === effect
      && item.passageId === passage.id && item.recipients.includes('player') && item.recipients.includes(speakerId)))).toBe(true);
  }
});

test('an attributed account remains distinct from proof until the player explicitly chooses to inspect it', async () => {
  let save = start({ dramatica: true });
  const privateDetail = item => item.title === 'Material handled by Market baker';
  expect(actorContext(save.state, 'market-baker').observations.some(privateDetail)).toBe(true);
  expect(actorContext(save.state, 'player').observations.some(privateDetail)).toBe(false);
  expect(actorContext(save.state, 'alice').observations.some(privateDetail)).toBe(false);

  save = await choose(save, 'help');
  const publicReport = playerView(save).observations.find(item => item.text === beat(save).dramaticBeat.effect);
  expect(publicReport).toMatchObject({ source: 'Market baker', status: 'reported' });
  expect(save.state.passages.at(-1).paragraphs).toEqual([expect.stringMatching(/^Market baker reports that .* Those details are their account/u)]);
  expect(actorContext(save.state, 'alice').observations.find(item => item.id === publicReport.id)?.status).toBe('reported');

  const examined = await choose(save, 'verify');
  expect(beat(examined).outcome).toBe('verified');
  expect(playerView(examined).observations).toContainEqual(expect.objectContaining({
    source: 'the dawn bread tally', status: 'firsthand', text: publicReport.text, supersedes: publicReport.id,
  }));

  save = await choose(save, 'help');
  expect(beat(save).outcome).toBe('reported');
  expect(save.state.campaign.step).toBe(5);
  expect(actorContext(save.state, 'market-baker').observations).toContainEqual(expect.objectContaining({
    title: 'Account of the decision', source: 'Alice', status: 'reported',
  }));
  expect(actorContext(save.state, 'market-baker').observations.some(item => item.title.startsWith('Decision about '))).toBe(false);
  expect(beat(save).dramaticBeat).toMatchObject({ kind: 'decision', decision: 'reported', speakerId: 'alice',
    effect: expect.stringContaining('beside the unfilled witness line'),
  });
});

test('standing aside leaves responsibility in place and opens different cases from doing the verified work', async () => {
  let verification = start({ dramatica: true });
  const deferral = await choose(start({ dramatica: true }), 'defer');
  for (let index = 0; index < 2; index += 1) {
    verification = await choose(verification, 'verify');
  }
  expect(deferral.state.campaign.step).toBe(5);
  expect(beat(deferral)).toMatchObject({ outcome: 'deferred', dramaticBeat: { effect: expect.stringContaining('Alice keeps charge of the matter') } });
  expect(playerView(deferral).observations.some(item => item.title.startsWith('Evidence about '))).toBe(false);
  expect(options(deferral)[0].caseId).not.toBe(options(verification)[0].caseId);
  expect(options(deferral).every(item => !item.arrival)).toBe(true);
  const moved = await choose(deferral, 'next');
  expect(moved.state.campaign).toMatchObject({ chapter: 2, step: 1, evidence: null });
});

test('existing campaign saves keep their original opening and intermediate steps', async () => {
  let save = start({ campaign: true });
  expect(playerView(save).scene.id).toBe('bakehouse');
  save = await play(save, 'Take the ledger to Martin');
  save = await play(save, 'Give Martin the names');
  save = await play(save, campaignStart);
  expect(save.state.campaign.dramatica).toBeUndefined();
  expect(playerView(save).campaign.step).toBe(0);
  save = await choose(await choose(save, 'verify'), 'verify');
  expect(playerView(save).campaign.step).toBe(2);
  expect(save.state.records.some(record => record.dramaticBeat)).toBe(false);
});
