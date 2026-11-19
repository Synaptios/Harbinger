import { expect, test } from '@playwright/test';
import { campaignStart } from '../app/campaign.mjs';
import { playerView, startEpisode, title } from '../app/episode.mjs';
import { actorContext } from '../app/knowledge.mjs';
import { resolveTurn } from '../app/turns.mjs';
import { createCovelActors } from '../covel/actors.mjs';
import { advanceAvenue } from '../covel/story-pacing.mjs';

async function act(save, action) {
  const result = await resolveTurn(save, action);
  expect(result.clarification, action).toBeUndefined();
  return { ...save, state: result.state, revision: save.revision + 1 };
}

async function atOriginalEnding(campaign) {
  let save = { state: startEpisode({ campaign }), id: 'campaign-test', name: title, revision: 0 };
  save = await act(save, 'Take the ledger to Martin');
  return act(save, 'Give Martin the names');
}

function choice(save, stance) {
  return playerView(save).campaign.options.find(option => option.stance === stance)?.label;
}

test('a regular Bread Ledger still ends while a long run can continue on the next morning', async () => {
  expect(playerView(await atOriginalEnding(false))).toMatchObject({ ended: true, choices: [] });
  let extended = await atOriginalEnding(true);
  expect(playerView(extended)).toMatchObject({ ended: false, choices: [campaignStart], scene: { id: 'licensedOven' } });
  const originalMinute = extended.state.minute;
  extended = await act(extended, campaignStart);
  expect(playerView(extended)).toMatchObject({
    campaign: { chapter: 1, step: 0, actorName: 'Alice' }, scene: { id: 'campaign', time: 'Dawn' },
  });
  expect(extended.state.campaign.openingEnding).toBe('licensedOven');
  expect(extended.state.minute).toBeGreaterThan(originalMinute);
});

test('a campaign can resolve 500 consecutive choices, revisit prior decisions, and keep evidence sourced', async () => {
  test.slow();
  let save = await atOriginalEnding(true);
  save = await act(save, campaignStart);
  for (let turn = 1; turn <= 500; turn++) {
    const campaign = playerView(save).campaign;
    const preference = campaign.chapter % 2 === 0 ? 'defer' : 'verify';
    save = await act(save, choice(save, preference) ?? choice(save, 'next'));
  }
  const { state } = save;
  const ending = playerView(save);
  expect(save.revision).toBe(503);
  expect(state.passages).toHaveLength(504);
  expect(ending.ended).toBe(false);
  expect(ending.campaign.chapter).toBeGreaterThan(80);
  const decisions = state.records.filter(record => record.type === 'campaign-act' && record.step === 3);
  expect(decisions.length).toBeGreaterThan(80);
  const verified = decisions.find(record => record.outcome === 'verified');
  const deferred = decisions.find(record => record.outcome === 'deferred');
  expect(verified).toBeTruthy();
  expect(deferred).toBeTruthy();
  expect(state.passages.some(item => item.paragraphs.some(line => line.startsWith('The earlier entry is still available')))).toBe(true);
  expect(state.passages.some(item => item.paragraphs.some(line => line.startsWith('There is still a gap in the earlier entry')))).toBe(true);
  expect(ending.observations.every(item => item.source && state.passages.some(passage => passage.id === item.passageId))).toBe(true);
});

test('only the actual case witness can answer a direct question with their document detail', async () => {
  let save = await atOriginalEnding(true);
  save = await act(save, campaignStart);
  save = await act(save, choice(save, 'defer'));
  const { question, actorName } = playerView(save).campaign;
  expect(actorName).toBe('Market baker');
  const isMaterial = item => item.title === 'Material handled by Market baker';
  expect(actorContext(save.state, 'market-baker').observations.some(isMaterial)).toBe(true);
  expect(actorContext(save.state, 'player').observations.some(isMaterial)).toBe(false);
  expect(actorContext(save.state, 'alice').observations.some(isMaterial)).toBe(false);
  const captured = [];
  const actor = createCovelActors({}, { completeCharacter: async ({ context }) => {
    captured.push(context);
    return { reply: 'I can tell you there are three dawn marks, without promising what will be baked.', meetingId: null };
  } });
  await actor.respond(save.state, { actorId: 'market-baker', words: 'Have you seen anything unusual?' });
  await actor.respond(save.state, { actorId: 'market-baker', words: 'I want to be sure. ' + question });
  expect(captured[0].evidence.some(isMaterial)).toBe(false);
  expect(captured[1].evidence.some(isMaterial)).toBe(true);
  expect(captured[1].setting.time).toBe('Dawn');
});

test('a campaign speaker receives another case only when the clerk asks to recall it', async () => {
  let save = await act(await atOriginalEnding(true), campaignStart);
  const recalledSpeech = 'What should we keep for the workers who arrive earliest?';
  const syntheticReply = 'The dawn share is small. I want to keep its marks separate.';
  const earlier = await resolveTurn(save, 'I ask Alice, “' + recalledSpeech + '”', {
    respond: async () => ({ actorId: 'alice', name: 'Alice', grounded: true, reply: syntheticReply }),
  });
  save = { ...save, state: earlier.state, revision: save.revision + 1 };
  for (let chapter = 1; chapter <= 3; chapter++) {
    for (let step = 0; step <= 5; step++) save = await act(save, choice(save, 'verify') ?? choice(save, 'next'));
  }
  const current = playerView(save).campaign;
  expect(current).toMatchObject({ chapter: 4, actorName: 'Alice' });
  const prompts = [];
  const actor = createCovelActors({}, { completeCharacter: async ({ context }) => {
    prompts.push(context);
    return { reply: 'I can answer for an account I have seen.', meetingId: null };
  } });
  await actor.respond(save.state, { actorId: 'alice', words: current.question });
  await actor.respond(save.state, { actorId: 'alice', words: 'Do you remember the dawn bread tally from the earlier case?' });
  expect(prompts[0].evidence.some(item => item.topic === 'campaign:dawn-share' || item.text === syntheticReply)).toBe(false);
  expect(prompts[0]).not.toHaveProperty('recentSpeech');
  expect(prompts[1].evidence.some(item => item.topic === 'campaign:dawn-share')).toBe(true);
  expect(prompts[1].evidence.some(item => item.text === syntheticReply)).toBe(true);
  expect(prompts[1].evidence.some(item => item.topic === 'campaign:two-notches')).toBe(false);
});

test('the original bread avenue can pay off in an active continuation scene', async () => {
  let save = await atOriginalEnding(true);
  save = await act(save, campaignStart);
  save.state.pacing = { turn: 20, nextReview: 27, active: { id: 'bread-supply', startedTurn: 2, stage: 2 }, completed: [], queued: null };
  const payoff = advanceAvenue(save.state, save.state.passages.at(-1));
  expect(payoff?.avenueId).toBe('bread-supply');
  expect(save.state.pacing.completed).toContain('bread-supply');
  expect(playerView(save).observations).toContainEqual(expect.objectContaining({ topic: 'pacing:bread-supply', status: 'firsthand' }));
});

test('comparing already examined material adds the stakes without repeating the evidence in the public record', async () => {
  let save = await act(await atOriginalEnding(true), campaignStart);
  save = await act(save, choice(save, 'verify'));
  save = await act(save, choice(save, 'verify'));
  const [material] = playerView(save).observations.filter(item => item.title === 'Evidence about the dawn bread tally');
  expect(material.status).toBe('firsthand');
  expect(actorContext(save.state, 'alice').observations.some(item => item.text === material.text)).toBe(false);

  save = await act(save, choice(save, 'verify'));
  expect(save.state.passages.at(-1).paragraphs.join(' ')).toContain('the early workers have nowhere else to queue');
  expect(save.state.passages.at(-1).paragraphs.join(' ')).not.toContain(material.text);
  expect(playerView(save).observations.filter(item => item.text === material.text)).toEqual([material]);
  expect(actorContext(save.state, 'alice').observations).toContainEqual(expect.objectContaining({
    title: 'Evidence reviewed alongside the account', text: material.text, status: 'firsthand', source: material.source,
  }));
});

test('comparing a previous report promotes it to corroboration by the document with separate provenance', async () => {
  let save = await act(await atOriginalEnding(true), campaignStart);
  save = await act(save, choice(save, 'help'));
  save = await act(save, choice(save, 'help'));
  const [report] = playerView(save).observations.filter(item => item.title === 'Evidence about the dawn bread tally');
  expect(report).toMatchObject({ status: 'reported', source: 'Market baker' });

  save = await act(save, choice(save, 'verify'));
  expect(save.state.passages.at(-1).paragraphs.join(' ')).not.toContain(report.text);
  const evidence = playerView(save).observations.filter(item => item.text === report.text);
  expect(evidence).toEqual([report, expect.objectContaining({
    status: 'firsthand', source: 'the dawn bread tally', supersedes: report.id,
  })]);
});

test('follow-through actions and outcomes correspond to the actual disposition', async () => {
  const variants = [
    [['verify', 'verify', 'verify', 'verify'], 'verified', 'Check what the verified entry allows', /mark the early collections/u],
    [['help', 'help', 'defer', 'help'], 'reported', 'Check whose account was recorded', /place left for a witness/u],
    [['press', 'defer', 'press', 'press'], 'held', 'Check which claim was kept out', /claim is still outside the account/u],
    [['defer', 'defer', 'defer', 'defer'], 'deferred', 'Check who still has the matter in hand', /no ruling in the record to carry out/u],
    [['verify', 'defer', 'press', 'verify'], 'provisional', 'Check what proof the provisional entry still needs', /cannot stand as proof/u],
  ];
  for (const [stances, disposition, label, result] of variants) {
    let save = await act(await atOriginalEnding(true), campaignStart);
    for (const stance of stances) save = await act(save, choice(save, stance));
    expect(playerView(save).campaign.step).toBe(4);
    expect(choice(save, 'verify')).toBe(label);
    expect(playerView(save).choices).not.toContain('Check what was put into effect');

    save = await act(save, label);
    expect(save.state.passages.at(-1).paragraphs.join(' ')).toMatch(result);
    expect(save.state.records.at(-1)).toMatchObject({ type: 'campaign-act', step: 4, disposition });
  }
});
