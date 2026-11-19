import { expect, test } from '@playwright/test';
import { campaignPlayerAction } from '../scripts/covel-campaign-profiles.mjs';
import { playerProfiles } from '../scripts/covel-player-profiles.mjs';

const stances = [
  { stance: 'verify', label: 'Ask which names the witness can vouch for' },
  { stance: 'help', label: 'Offer to keep the records in order' },
  { stance: 'press', label: 'Press Martin on the unanswered entry' },
  { stance: 'defer', label: 'Hear Martin out before taking a side' },
];
const chapterEnd = [{ stance: 'next', label: 'Leave the guild room' }];

function situation(chapter, step, options = step === 4 ? chapterEnd : stances) {
  return {
    scene: { id: 'campaign' },
    choices: options.map(option => option.label),
    campaign: {
      chapter, step, options, actorName: 'Martin', question: 'Who can vouch for the marks in this book?',
    },
  };
}

function walk(profile) {
  let chapter = 1;
  let step = 1;
  const lastBeat = 4;
  const history = [];
  for (let turn = 1; turn <= 500; turn++) {
    const view = situation(chapter, step);
    const input = campaignPlayerAction(profile, { view, turn, history });
    const prior = history.at(-1);
    if (input.policy === 'choice') {
      expect(view.choices).toContain(input.action);
      step++;
      if (step > lastBeat) {
        step = 1;
        chapter++;
      }
    } else {
      expect(input.campaignBeat).not.toBe(prior?.campaignBeat);
      if (input.policy === 'speech-probe') expect(input.action).toMatch(/^I ask Martin, “.+\?”$/u);
      else expect(input.action).toBe('Look around');
    }
    history.push(input);
  }
  return { history, chapter };
}

test('the ten deterministic profiles advance 500 turns with distinct decision and speech patterns', () => {
  const fingerprints = new Set();
  const runs = new Map();
  for (const profile of playerProfiles) {
    const result = walk(profile);
    expect(result.chapter).toBeGreaterThan(100);
    runs.set(profile.id, result.history);
    fingerprints.add(result.history.map(input => input.action).join('\n'));
  }
  expect(fingerprints.size).toBe(playerProfiles.length);
  expect(runs.get('passive').some(input => input.policy === 'observe-probe')).toBe(true);
  expect(runs.get('passive').filter(input => input.policy === 'speech-probe')).toHaveLength(0);
  expect(runs.get('cooperative').filter(input => input.policy === 'choice' && input.stance === 'help').length).toBeGreaterThan(250);
  expect(runs.get('murder-hobo').some(input => /start a fight|break/iu.test(input.action))).toBe(true);
  expect(runs.get('active-control').every(input => input.actionKind === 'say' && !input.speechOverlay)).toBe(true);
  expect(walk('curious').history).toEqual(runs.get('curious'));
});

test('a continuation action keeps the exact public label and skips unoffered option labels', () => {
  const options = [{ stance: 'next', label: 'Return to the lane the next morning' }];
  const view = situation(1, 4, options);
  view.campaign.options = [...stances, ...options];
  const input = campaignPlayerAction('murder-hobo', { view, turn: 20 });
  expect(input).toMatchObject({ action: options[0].label, policy: 'choice', stance: 'next' });
});

test('the active control preserves original spellings and native say mode in its opening', () => {
  const cases = [
    { turn: 1, scene: 'bakehouse', choices: ['Ask Martin about the proclamation'], want: 'Ask Martin about the proclamation' },
    { turn: 4, scene: 'bakehouse', choices: [], want: 'I ask Martin, “What would you count as a witness?”' },
    { turn: 10, scene: 'guildInspection', choices: ['Give Martin the names'], want: 'Give Martin the names' },
  ];
  for (const scenario of cases) {
    const input = campaignPlayerAction('active-control', {
      turn: scenario.turn, view: { scene: { id: scenario.scene }, choices: scenario.choices },
    });
    expect(input).toMatchObject({ action: scenario.want, actionKind: 'say', policy: 'opening', speechOverlay: false });
  }
});
