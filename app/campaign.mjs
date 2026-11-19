import { campaignCases } from './campaign-cases.mjs';
import { dramaticOptions, dramaticUnverifiedWork } from './campaign-drama.mjs';
import { campaignPrecedent } from './campaign-followups.mjs';
import { campaignPractice, campaignVerifiedWork } from './campaign-practice.mjs';
import { advanceAgenda, timeOfDay } from './director.mjs';

export const campaignStart = 'Return to the lane the next morning';
const campaignSceneId = 'campaign';
const roles = {
  alice: { name: 'Alice' },
  martin: { name: 'Martin' },
  'market-baker': { name: 'Market baker', goal: 'Keep the oven earning its fuel and honor the use already promised.',
    style: 'Plain, practical, and attentive to heat, fuel, and the work still waiting.' },
  'market-carter': { name: 'Market carter', goal: 'Put each hire against the right load and preserve the carters’ credit.',
    style: 'Direct and impatient with guesses. Speaks in marks, routes, and wages.' },
  'river-carter': { name: 'River carter', goal: 'Know what reached the landing and protect people who worked the handoff.',
    style: 'Short phrases, concrete descriptions, careful about places and times.' },
  'guild-runner': { name: 'Guild runner', goal: 'Deliver the right paper without claiming authority over what it says.',
    style: 'Matter-of-fact, attentive to where a paper was received and when it left their hand.' },
};

const moods = {
  alice: 'careful about whose work she is putting at risk',
  martin: 'concerned about the record being read later',
};

const followThrough = {
  verified: {
    question: 'What work can go ahead under the part that was verified?',
    options: [
      ['verify', 'Check what the verified entry allows'], ['help', 'Offer help with the part that was agreed'],
      ['press', 'Ask where the verified finding stops'], ['defer', 'Leave the agreed work to the people responsible for it'],
    ],
    boundary: 'The entry can guide this part of the work. It leaves the rest of the disagreement open.',
  },
  reported: {
    question: 'Whose account was put on the record, and what does it still lack?',
    options: [
      ['verify', 'Check whose account was recorded'], ['help', 'Offer to look for someone who can witness it'],
      ['press', 'Ask why the report still needs a witness'], ['defer', 'Leave the report under its named source'],
    ],
    boundary: 'The name beside the account belongs to its source. It does not fill the place left for a witness.',
  },
  held: {
    question: 'What would let the disputed line be brought back?',
    options: [
      ['verify', 'Check which claim was kept out'], ['help', 'Offer to look for support for the withheld claim'],
      ['press', 'Ask what would let the disputed line be brought back'], ['defer', 'Leave the disputed claim out of the account'],
    ],
    boundary: 'The disputed claim is still outside the account. Someone would have to bring support before it went in.',
  },
  deferred: {
    question: 'Who still has the matter in hand?',
    options: [
      ['verify', 'Check who still has the matter in hand'], ['help', 'Offer help to the people still weighing the matter'],
      ['press', 'Ask where responsibility for deciding now rests'], ['defer', 'Leave the matter with the people doing the work'],
    ],
    boundary: 'The people doing the work still have the matter in hand. There is no ruling in the record to carry out.',
  },
  provisional: {
    question: 'What would let the provisional entry stand as proof?',
    options: [
      ['verify', 'Check what proof the provisional entry still needs'], ['help', 'Offer to trace the missing source'],
      ['press', 'Ask what keeps the open entry from being treated as proof'], ['defer', 'Leave the entry open until someone brings proof'],
    ],
    boundary: 'The entry stays open. It can show where to look for an answer, but it cannot stand as proof.',
  },
};

const verifiedWork = {
  'dawn-share': 'mark the early collections separately from the ones made later',
  'loose-seal': 'record the condition of the wax without naming whose hand stamped it',
  'two-notches': 'keep each receipt with its own hire when somebody disputes a charge',
  'wet-fuel': 'sort the dry wood for the first firing without laying the wet delivery at anyone’s door',
  'blank-witness': 'file the report under its source and keep the separate place for an eyewitness',
  'uneven-sack': 'send on usable flour without turning the torn seam into a finding about when it tore',
  'bakers-hour': 'give the main batch its turn before the later tray, which still depends on the heat falling',
  'yesterdays-entry': 'record when the slip reached its receiving hand without deciding when the load left',
  'loaned-peel': 'ask for work on the loose handle while keeping the rest of the loan as it stands',
  'lost-cord': 'save a description of the tag for comparison if the matching receipt turns up',
  'spare-key': 'keep a limited errand separate from the continuing responsibility for the room',
  'short-measure': 'compare the measure before the next use while leaving the recorded sum open to better evidence',
  'shutter-copy': 'put up the public hours without copying an instruction intended for the runner',
  'paid-morning': 'set the paid loaf aside until there is a collection mark',
  'lower-step': 'consider the time of the unloading without treating the signature as the boat’s arrival',
  'margin-space': 'leave room for a named correction while keeping the original account legible',
};

function recordedDisposition(state, entry) {
  const record = state.records.findLast(item => item.type === 'campaign-act' && item.step === 3
    && item.chapter === state.campaign.chapter && item.caseId === entry.id);
  return Object.hasOwn(followThrough, record?.outcome) ? record.outcome : null;
}

export function startCampaign({ dramatica = false } = {}) {
  return { chapter: 0, step: 0, cases: {}, ...(dramatica && { dramatica: true }) };
}

function currentCase(state) {
  const chapter = state.campaign?.chapter;
  if (state.scene !== campaignSceneId || !Number.isSafeInteger(chapter) || chapter < 1) return;
  if (state.campaign.dramatica) return campaignCases.find(entry => entry.id === state.campaign.caseId);
  return campaignCases[(chapter - 1) % campaignCases.length];
}

function actorFor(state, entry = currentCase(state)) {
  if (!entry) return;
  if (state.campaign.dramatica) {
    return state.campaign.step === 1 || (state.campaign.step === 4 && state.campaign.decision === 'reported')
      ? entry.witness : entry.sponsor;
  }
  return [1, 4].includes(state.campaign.step) ? entry.witness : entry.sponsor;
}

function chapterHeading(entry, step) {
  const phrases = [
    entry.title, 'Beside ' + entry.object, 'The cost of an entry', 'A line to answer for',
    'Where the matter now stands', 'The unfinished work',
  ];
  return phrases[step];
}

export function campaignTime(minute) {
  return timeOfDay(minute % 1440);
}

export function campaignActors(state) {
  const actor = actorFor(state);
  return actor ? [actor] : null;
}

function stageOptions(state, entry) {
  const { object } = entry;
  const disposition = state.campaign.step === 4 ? recordedDisposition(state, entry) : null;
  const practice = disposition && campaignPractice(state, entry, disposition);
  if (state.campaign.dramatica) {
    const work = disposition === 'verified' && campaignVerifiedWork(entry.id);
    const follow = followThrough[disposition]?.options.map(([stance, label]) => ({
      stance, label: practice?.stance === stance ? practice.label : (work && stance === 'verify' ? work[0] : label),
    })) ?? [];
    return dramaticOptions(state, entry, follow);
  }
  const review = state.campaign.evidence === 'firsthand'
    ? 'Enter only the verified detail about ' + object : 'Ask for the entry to remain provisional';
  const options = [
    [
      ['verify', 'Ask to examine ' + object], ['help', 'Offer to help with ' + object],
      ['press', 'Ask who can answer for ' + object], ['defer', 'Hear the account and withhold judgment'],
    ],
    [
      ['verify', 'Examine ' + object], ['help', 'Ask the witness to read out the relevant detail'],
      ['press', 'Ask the witness what they saw for themselves'], ['defer', 'Leave the evidence unexamined'],
    ],
    [
      ['verify', 'Compare the account with ' + object], ['help', 'Offer to take the smallest useful step'],
      ['press', 'Ask the sponsor to say who carries the cost'], ['defer', 'Leave the question of cost with the sponsor'],
    ],
    [
      ['verify', review], ['help', 'Offer your note with its source attached'],
      ['press', 'Keep the disputed line out of the account'], ['defer', 'Leave the decision to those involved'],
    ],
    state.campaign.step === 4
      ? followThrough[disposition]?.options ?? [['defer', 'Leave the matter with the people involved']]
      : [],
    [['next', 'Take up the next matter in the lane']],
  ];
  return options[state.campaign.step]?.map(([stance, label]) => ({
    stance, label: practice?.stance === stance ? practice.label : label,
  })) ?? [];
}

export function campaignScene(state) {
  const entry = currentCase(state);
  if (entry) return {
    heading: state.campaign.dramatica && state.campaign.step === 1 ? entry.title : chapterHeading(entry, state.campaign.step), location: entry.location,
    choices: stageOptions(state, entry).map(({ label }) => label),
  };
}

export function campaignPublic(state) {
  const entry = currentCase(state);
  if (entry) {
    const { chapter, step } = state.campaign;
    const actorId = actorFor(state, entry);
    const question = [
      'What do you need me to understand about ' + entry.object + '?', entry.question,
      'Who will feel the cost if the account is left as it stands?',
      'What would you be willing to have entered under your own name?',
      step === 4 ? followThrough[recordedDisposition(state, entry)]?.question ?? 'What is still open here?' : null,
      'Is there anything from this matter someone may need to come back for?',
    ][step];
    return { chapter, step, actorName: roles[actorId].name, question, options: stageOptions(state, entry) };
  }
}

export function campaignSpeechScope(state, actorId, words) {
  const entry = currentCase(state);
  if (!entry || actorFor(state, entry) !== actorId) return;
  const topicalText = value => value.toLowerCase().replace(/[’']/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const day = Math.floor(state.minute / 1440);
  const topic = 'campaign:' + entry.id;
  const asksForHistory = /\b(?:remember|recall|last time|last visit|(?:previous|earlier|first|last) (?:case|matter|dispute|visit)|when we (?:first|last) spoke|you (?:said|told) me)\b/iu.test(words)
    && (/\?/u.test(words) || /\b(?:remind me|tell me again)\b/iu.test(words));
  const query = ' ' + topicalText(words) + ' ';
  const named = asksForHistory ? campaignCases.filter(item =>
    [item.title, item.object.replace(/^the /u, '')].some(value => query.includes(' ' + topicalText(value) + ' '))) : [];
  const requestedCases = new Set(asksForHistory ? (named.length ? named : [entry]).map(item => item.id) : []);
  const earlier = state.records.filter(item => item.type === 'campaign-opened' && requestedCases.has(item.caseId)
    && item.minute < day * 1440);
  const requested = /\b(?:first|original)\b/iu.test(words) ? earlier.slice(0, 1) : earlier.slice(-2);
  const knownDays = new Set(requested.map(item => Math.floor(item.minute / 1440)));
  const current = state.observations.filter(item => item.topic === topic
    && Math.floor(item.minute / 1440) === day && item.recipients.includes(actorId));
  const recalled = state.observations.filter(item => knownDays.has(Math.floor(item.minute / 1440))
    && item.topic?.startsWith('campaign:') && requestedCases.has(item.topic.slice('campaign:'.length))
    && item.recipients.includes(actorId));
  const exchangePassages = new Set(state.records.filter(item => item.type === 'actor-exchange'
    && item.actorId === actorId && (Math.floor(item.minute / 1440) === day || knownDays.has(Math.floor(item.minute / 1440))))
    .map(item => item.passageId));
  const directQuestion = words.trim().toLowerCase().endsWith(campaignPublic(state).question.toLowerCase());
  return {
    caseEvidence: new Set([...current, ...recalled].map(item => 'observation:' + item.id)),
    shareable: new Set(directQuestion ? current.map(item => 'observation:' + item.id) : []),
    exchangePassages,
  };
}

function advanceToMorning(state) {
  advanceAgenda(state, Math.floor(state.minute / 1440) * 1440 + 1810);
}

function passage(state, heading, text, paragraphs, actorIds) {
  const id = 'passage-' + state.passages.length;
  const { location } = campaignScene(state);
  state.passages.push({
    id, heading, location, time: campaignTime(state.minute), playerText: text,
    paragraphs, sceneId: campaignSceneId, minute: state.minute, actorIds,
  });
  return id;
}

function observe(state, id, { title, text, source, status, recipients, supersedes }) {
  const observation = {
    id: 'observation-' + state.observations.length, passageId: id, kind: 'clue',
    topic: 'campaign:' + currentCase(state).id, title, text, source, status,
    recipients: [...new Set(recipients)], minute: state.minute, ...(supersedes && { supersedes }),
  };
  state.observations.push(observation);
  return observation.id;
}

function admitActors(state, entry) {
  for (const id of [entry.sponsor, entry.witness]) {
    if (!state.actors[id]) {
      const { name, goal, style } = roles[id];
      state.actors[id] = {
        id, name, goal, emotion: moods[id] ?? 'working carefully under scrutiny',
        voice: { style },
      };
      state.relationships.push({ from: id, to: 'player', trust: 0 });
    }
  }
}

export function openDramaticChapter(state, caseId = campaignCases[0].id, text = null) {
  const previous = currentCase(state);
  const { chapter } = state.campaign;
  const cause = previous && state.records.findLast(item => item.type === 'campaign-act' && item.chapter === chapter);
  if (previous) advanceToMorning(state);

  state.scene = campaignSceneId;
  Object.assign(state.campaign, { caseId, chapter: chapter + 1, step: 1, evidence: null, decision: null });
  const entry = currentCase(state);
  admitActors(state, entry);
  const people = ['player', entry.sponsor, entry.witness];
  const id = passage(state, entry.title, text, [entry.opening, entry.stake], [entry.sponsor, entry.witness]);
  const sourceId = observe(state, id, { title: entry.title, text: entry.opening,
    source: roles[entry.sponsor].name, status: 'reported', recipients: people });
  observe(state, id, { title: 'Material handled by ' + roles[entry.witness].name, text: entry.evidence,
    source: entry.object, status: 'firsthand', recipients: [entry.witness] });
  state.records.push({
    type: 'campaign-opened', chapter: chapter + 1, caseId, previousCase: previous?.id ?? null,
    actorId: entry.sponsor, passageId: id, minute: state.minute, outcome: 'open',
    dramaticBeat: { kind: 'setup', cause: cause?.dramaticBeat?.effect ?? entry.stake, effect: entry.opening,
      decision: null, speakerId: entry.sponsor, sourceIds: [sourceId] },
  });
  return state;
}

function openChapter(state, text) {
  const thread = state.campaign;
  const original = state.scene !== campaignSceneId;
  if (original) thread.openingEnding = state.scene;
  const previous = original ? null : currentCase(state);
  state.scene = campaignSceneId;
  advanceToMorning(state);
  thread.chapter += 1;
  thread.step = 0;
  thread.evidence = null;
  thread.decision = null;
  const entry = currentCase(state);
  admitActors(state, entry);
  const precedent = thread.cases[entry.id];
  const practice = campaignPrecedent(state, entry.id, entry.sponsor);
  const paragraphs = [];
  if (original) paragraphs.push('The next morning brings its own work to the lane. A fresh account is waiting, separate from yesterday’s inspection.');
  if (precedent) paragraphs.push(precedent.outcome === 'verified'
    ? 'The earlier entry is still available when this instance comes up. It shows how the last account was settled; the new detail needs its own proof.'
    : 'There is still a gap in the earlier entry. The new dispute gives the people involved a reason to look again, without assuming that the old question has been answered.');
  const workingNote = practice ? roles[entry.sponsor].name + ' still means to ' + practice + '.' : null;
  if (workingNote) paragraphs.push(workingNote);
  paragraphs.push(entry.opening);
  const id = passage(state, entry.title, text, paragraphs, [entry.sponsor]);
  observe(state, id, { title: entry.title, text: entry.opening, source: roles[entry.sponsor].name,
    status: 'reported', recipients: ['player', entry.sponsor] });
  if (workingNote) observe(state, id, {
    title: 'The earlier practice brought forward', text: workingNote,
    source: roles[entry.sponsor].name, status: 'reported', recipients: ['player', entry.sponsor],
  });
  state.records.push({
    type: 'campaign-opened', chapter: thread.chapter, caseId: entry.id, previousCase: previous?.id ?? null,
    actorId: entry.sponsor, passageId: id, minute: state.minute, outcome: 'open',
  });
}

function evidenceChoice(thread, entry, stance, step) {
  if (stance === 'verify') {
    const earlier = thread.evidence;
    thread.evidence = 'firsthand';
    const comparing = step === 2 && earlier;
    const headline = comparing
      ? (earlier === 'reported'
        ? 'The earlier account can be checked against the source now. It bears out the detail the witness gave. '
        : 'The detail you already checked is enough to compare the source and the account without entering it twice. ') + entry.stake
      : entry.evidence;
    return { headline, status: 'firsthand', source: entry.object, ...(comparing && { earlier }) };
  }
  if (step === 1 && (stance === 'help' || stance === 'press')) {
    if (!thread.evidence) thread.evidence = 'reported';
    return { headline: 'The account comes from ' + roles[entry.witness].name.toLowerCase() + '. ' + entry.evidence,
      status: 'reported', source: roles[entry.witness].name };
  }
}

function decisionFor(thread, stance) {
  if (stance === 'press') return 'held';
  if (stance === 'defer') return 'deferred';
  if (thread.evidence === 'firsthand') return 'verified';
  return thread.evidence === 'reported' ? 'reported' : 'provisional';
}

function decisionLine(entry, outcome) {
  if (outcome === 'verified') return entry.result;
  if (outcome === 'reported') return 'The account is entered with its named source. A blank beside it leaves the question of sight and proof for another day.';
  if (outcome === 'held') return 'The disputed entry stays out of the account. The paper can still be brought back if somebody finds a way to answer for it.';
  if (outcome === 'deferred') return 'The people doing the work keep charge of the matter. For now the record gives no ruling and puts nobody’s name beside one.';
  return 'The record marks the matter as open. Nobody has entered ' + entry.object + ' as proof.';
}

function adjustTrust(state, actorId, stance, step, passageId) {
  const relationship = state.relationships.find(item => item.from === actorId && item.to === 'player');
  if (relationship && (stance === 'help' || (stance === 'press' && step === 3))) {
    relationship.trust = Math.max(-3, Math.min(3, relationship.trust + (stance === 'help' ? 1 : -1)));
    relationship.source = passageId;
  }
}

function dramaticAction(state, { stance, label }) {
  const thread = state.campaign;
  const entry = currentCase(state);
  const { chapter } = thread;
  const leaving = thread.step === 1 && stance === 'defer';
  const step = leaving ? 3 : thread.step;
  const prior = state.records.findLast(item => item.chapter === chapter && item.dramaticBeat);
  const previousActor = leaving ? entry.sponsor : actorFor(state, entry);
  const sponsor = roles[entry.sponsor].name;
  const witness = roles[entry.witness].name;
  const observations = [];
  const paragraphs = [];
  let speakerId = previousActor;
  let outcome = stance;
  let phase;
  let effect;
  let practice;

  function publicDetail(title, text, source, status = 'firsthand', supersedes) {
    observations.push({ title, text, source, status, supersedes });
  }

  if (step === 1) {
    phase = 'reveal';
    if (stance === 'verify') {
      thread.evidence = 'firsthand';
      effect = entry.evidence;
      paragraphs.push(`${witness} sets ${entry.object} within reach. ${effect}`);
      publicDetail('Evidence about ' + entry.object, effect, entry.object);
    } else if (stance === 'help' || stance === 'press') {
      thread.evidence = 'reported';
      effect = entry.evidence;
      const account = effect[0].toLowerCase() + effect.slice(1);
      paragraphs.push(`${witness} reports that ${account} Those details are their account.${stance === 'press'
        ? ` They keep ${entry.object} to hand for comparison.` : ''}`);
      publicDetail('Evidence about ' + entry.object, effect, witness, 'reported');
    }
    thread.step = 3;
  } else if (step === 3) {
    phase = 'decision';
    if (stance === 'verify' && thread.evidence !== 'firsthand') {
      const report = thread.evidence === 'reported' && state.observations.findLast(item => item.topic === 'campaign:' + entry.id
        && Math.floor(item.minute / 1440) === Math.floor(state.minute / 1440)
        && item.text === entry.evidence && item.status === 'reported' && item.recipients.includes('player'));
      thread.evidence = 'firsthand';
      paragraphs.push(entry.evidence);
      publicDetail('Evidence about ' + entry.object, entry.evidence, entry.object, 'firsthand', report?.id);
    }
    outcome = decisionFor(thread, stance);
    thread.decision = outcome;
    thread.cases[entry.id] = { chapter, outcome };
    const decision = decisionLine(entry, outcome);
    const work = outcome === 'verified' && campaignVerifiedWork(entry.id);
    if (work) effect = decision + ' ' + sponsor + ' ' + work[1];
    else if (outcome === 'reported') effect = `${sponsor} sets ${witness}’s account beside the unfilled witness line. The account stays under the name of the person who gave it.`;
    else if (outcome === 'held') effect = `${sponsor} sets the disputed line about ${entry.object} apart for someone who can bring support. The disputed detail stays out of the account.`;
    else if (outcome === 'deferred') effect = `${sponsor} keeps charge of the matter and leaves ${entry.object} to hand. The work is theirs to decide; nobody’s name goes beside a ruling today.`;
    else effect = dramaticUnverifiedWork(outcome, stance, entry, sponsor);
    paragraphs.push(effect);
    publicDetail('Decision about ' + entry.object, effect, sponsor + ' at ' + entry.location);
    thread.step = 5;
  } else {
    phase = 'consequence';
    const availablePractice = campaignPractice(state, entry, thread.decision);
    if (availablePractice?.label === label) practice = availablePractice;
    const work = thread.decision === 'verified' && campaignVerifiedWork(entry.id);
    if (practice) {
      speakerId = practice.actorId;
      effect = practice.text;
    } else if (work && ['verify', 'help'].includes(stance)) {
      effect = sponsor + ' ' + work[1];
    } else if (work && stance === 'press') {
      effect = `${sponsor} leaves the unresolved question beside the verified entry for the next person who uses it. ${followThrough.verified.boundary}`;
    } else {
      effect = dramaticUnverifiedWork(thread.decision, stance, entry, roles[speakerId].name);
    }
    paragraphs.push(effect);
    publicDetail(practice?.title ?? 'Work after the decision on ' + entry.object, effect, roles[speakerId].name + ' at ' + entry.location);
    thread.step = 5;
  }

  advanceAgenda(state, state.minute + (step === 3 ? 32 : 18));
  const people = [...new Set([previousActor, actorFor(state, entry), speakerId, ...(leaving || (step === 3 && outcome === 'reported') ? [entry.witness] : [])])];
  const id = passage(state, chapterHeading(entry, thread.step), label, paragraphs, people);
  const recipients = step === 3 ? ['player', entry.sponsor] : ['player', ...people];
  const sourceIds = observations.map(item => observe(state, id, { ...item, recipients }));
  // A witness may hear the sponsor's disposition without being an authority on it.
  if (step === 3 && people.includes(entry.witness)) observe(state, id, {
    title: 'Account of the decision', text: effect, source: sponsor, status: 'reported', recipients: [entry.witness],
  });
  adjustTrust(state, previousActor, stance, step, id);
  state.records.push({
    type: 'campaign-act', chapter, step, caseId: entry.id, actorId: previousActor, stance, outcome,
    passageId: id, minute: state.minute, ...(step === 4 && { disposition: thread.decision }),
    ...(practice && { work: practice.record }),
    dramaticBeat: { kind: phase, cause: prior?.dramaticBeat?.effect ?? entry.opening, effect,
      decision: step === 1 ? null : thread.decision, speakerId, sourceIds },
  });
}

function stagedAction(state, option) {
  const thread = state.campaign;
  const entry = currentCase(state);
  const { step, chapter } = thread;
  const { stance, label } = option;
  const sponsor = roles[entry.sponsor].name;
  const witness = roles[entry.witness].name;
  const paragraphs = [];
  const disposition = step === 4 ? recordedDisposition(state, entry) : null;
  const availablePractice = disposition && campaignPractice(state, entry, disposition);
  const practice = availablePractice?.label === label ? availablePractice : null;
  const evidence = (step === 1 || step === 2) ? evidenceChoice(thread, entry, stance, step) : undefined;
  let observed;
  let outcome = stance;
  if (step === 0) {
    const openings = {
      verify: sponsor + ' arranges for ' + entry.object + ' to be set out. The description can wait until the thing itself is to hand.',
      help: sponsor + ' accepts the offer of a second pair of eyes. The work starts with finding out what can actually be shown.',
      press: sponsor + ' points the question toward the person who handled the evidence. Nobody is being asked to sign for it yet.',
      defer: sponsor + ' goes on with the account without asking you to endorse it. The question can stay open while you hear what the witness has to say.',
    };
    paragraphs.push(openings[stance]);
  } else if (step === 1 || step === 2) {
    if (evidence) {
      paragraphs.push(evidence.headline);
      const earlierReport = evidence.earlier === 'reported' && state.observations.findLast(item =>
        item.topic === 'campaign:' + entry.id && Math.floor(item.minute / 1440) === Math.floor(state.minute / 1440)
        && item.status === 'reported' && item.text === entry.evidence && item.recipients.includes('player'));
      observed = {
        title: evidence.earlier === 'firsthand' ? 'Evidence reviewed alongside the account' : 'Evidence about ' + entry.object,
        text: entry.evidence, source: evidence.source, status: evidence.status, supersedes: earlierReport?.id,
        recipients: evidence.earlier === 'firsthand' ? [entry.sponsor] : ['player', actorFor(state, entry)],
      };
    } else if (step === 1) {
      paragraphs.push('The witness leaves the material where it can be examined later. No new detail from ' + entry.object + ' goes into your account.');
    } else {
      const responses = {
        help: sponsor + ' welcomes the offer and keeps the next step small enough to be carried through. ' + entry.stake,
        press: sponsor + ' sets out what is at stake before anybody reaches for the book. ' + entry.stake,
        defer: sponsor + ' takes responsibility for weighing the cost of the decision. ' + entry.stake,
      };
      paragraphs.push(responses[stance]);
    }
  } else if (step === 3) {
    outcome = decisionFor(thread, stance);
    thread.decision = outcome;
    paragraphs.push(decisionLine(entry, outcome));
    thread.cases[entry.id] = { chapter, outcome };
    observed = { title: 'Decision about ' + entry.object, text: paragraphs[0], source: sponsor + ' at ' + entry.location,
      status: 'firsthand', recipients: ['player', entry.sponsor] };
  } else if (step === 4) {
    const responses = {
      verify: witness + ' shows where the account about ' + entry.object + ' now stands.',
      help: witness + ' takes your offer as help with the matter still at hand. Nothing gets entered as work already done.',
      press: witness + ' keeps the answer to what the account about ' + entry.object + ' can support.',
      defer: witness + ' leaves the next work to the people already responsible for the matter.',
    };
    const allowableWork = disposition === 'verified' && verifiedWork[entry.id];
    const boundary = followThrough[disposition]?.boundary;
    paragraphs.push(practice?.text ?? responses[stance]);
    if (!practice && allowableWork) paragraphs.push('The verified entry gives them room to ' + allowableWork + '.');
    if (boundary) paragraphs.push(boundary);
  }
  advanceAgenda(state, state.minute + (step === 3 ? 110 : 16));
  const previousActor = actorFor(state, entry);
  thread.step += 1;
  const currentActor = actorFor(state, entry);
  const id = passage(state, chapterHeading(entry, thread.step), label, paragraphs, [previousActor, currentActor]);
  if (observed) observe(state, id, observed);
  if (practice) observe(state, id, {
    title: practice.title, text: practice.text, status: 'firsthand', source: roles[practice.actorId].name + ' at ' + entry.location,
    recipients: ['player', practice.actorId],
  });
  if (thread.step === 1) observe(state, id, {
    title: 'Material handled by ' + witness, text: entry.evidence, source: entry.object,
    status: 'firsthand', recipients: [entry.witness],
  });
  if (thread.step === 4) observe(state, id, {
    title: 'Account of the decision', text: decisionLine(entry, thread.decision), source: sponsor,
    status: 'reported', recipients: [entry.witness],
  });
  adjustTrust(state, previousActor, stance, step, id);
  state.records.push({
    type: 'campaign-act', chapter, step, caseId: entry.id, actorId: previousActor, stance, outcome,
    passageId: id, minute: state.minute, ...(step === 4 && { disposition }),
    ...(practice && { work: practice.record }),
  });
}

export function campaignTurn(state, text, canStart) {
  if (!state.campaign) return;
  const normalized = text.trim().toLowerCase();
  const entry = currentCase(state);
  if (!entry) {
    if (!canStart || normalized !== campaignStart.toLowerCase()) return;
    const result = structuredClone(state);
    openChapter(result, campaignStart);
    return { state: result };
  }
  const option = stageOptions(state, entry).find(({ label }) => label.toLowerCase() === normalized);
  if (!option) return;
  const result = structuredClone(state);
  if (result.campaign.dramatica) {
    if (option.stance === 'next') {
      openDramaticChapter(result, option.caseId, option.arrival ? null : option.label);
      if (option.arrival) dramaticAction(result, { stance: option.arrival, label: option.label });
    } else dramaticAction(result, option);
  } else if (option.stance === 'next') openChapter(result, option.label);
  else stagedAction(result, option);
  return { state: result };
}
