import { campaignCases } from './campaign-cases.mjs';

const byId = new Map(campaignCases.map(entry => [entry.id, entry]));
const venues = ['bakehouse', 'guildInspection', 'landing', 'marketTally'];

// These are choices a person can make about their own future work. They do not
// decide another person's liability, turn an offer into work done, or add proof.
const workingPractices = {
  'dawn-share': [
    'keep separate lines for dawn and later collections so the baker can see whom the early share reaches',
    'leave the dawn count open until the first actual collections can be marked',
  ],
  'loose-seal': [
    'describe where the wax sits before asking who first stamped a paper',
    'keep the permit and the runner’s account together without putting a broken seal down as somebody’s fault',
  ],
  'two-notches': [
    'compare the receipt for the hire itself before charging either customer twice',
    'keep one receipt apart until its own notch can be matched to the hire',
  ],
  'wet-fuel': [
    'sort the dry fuel for the first firing before putting a claim about the wet delivery against a name',
    'leave the charge for the wet wood open and use only what can be found dry',
  ],
  'blank-witness': [
    'put the brought account under its source and leave the eyewitness line separate',
    'hold the eyewitness line empty until somebody at the gate can answer for it',
  ],
  'uneven-sack': [
    'check the seam and the handoff mark together before moving flour that can still be used',
    'keep the damaged sack’s condition separate from the question of where it tore',
  ],
  'bakers-hour': [
    'keep the order of the trays clear without promising the minute when the oven will cool',
    'leave the later tray’s firing conditional until its turn and the oven heat are both established',
  ],
  'yesterdays-entry': [
    'write the hour a slip was received beside the receiving hand and leave the earlier journey separate',
    'keep the earlier delivery date open to a person who can answer for its journey',
  ],
  'loaned-peel': [
    'record which part of the borrowed tool needs work before speaking of replacement or repayment',
    'keep the repair question separate from the goodwill under which the tool was lent',
  ],
  'lost-cord': [
    'put the clear stroke and the missing part on the same line for the next person comparing the tag',
    'keep the cord unassigned until a receipt matches more than the one visible scratch',
  ],
  'spare-key': [
    'give the errand and the keeping of the room their own lines when a key is lent',
    'avoid treating the borrower as the room’s keeper on the strength of a borrowed key',
  ],
  'short-measure': [
    'compare the measure before the next count while leaving the older recorded sum as it was',
    'leave the date of the repair open rather than putting a shortage against a person on a guess',
  ],
  'shutter-copy': [
    'copy the public work hours where people can read them without carrying over the runner’s private instruction',
    'keep the posting instruction out of any account of what the public is allowed to do',
  ],
  'paid-morning': [
    'hold paid bread apart until it has a collection mark instead of treating the payment stroke as collection',
    'leave the collection space open and avoid charging again while nobody can say the loaf was collected',
  ],
  'lower-step': [
    'give the arrival and the signing their own hours before an account of late work is entered',
    'leave the question of delay open until the receiving hand can say which hour they signed for',
  ],
  'margin-space': [
    'keep the old attribution legible and reserve the next line for somebody to make a correction under their own name',
    'leave a line for the disputed account to be answered without erasing the name it came under',
  ],
};

const disposition = {
  verified: 'the narrow verified entry',
  reported: 'the entry that records a source’s account',
  provisional: 'the entry marked provisional',
  held: 'the disputed line left out of the account',
  deferred: 'the question left with the people doing the work',
};
const caseRecord = record => record.type === 'campaign-act' && record.step === 3
  && Object.hasOwn(disposition, record.outcome) && byId.has(record.caseId);

const campaignFollowupId = chapter => 'campaign-followup:' + chapter;

function followupChapter(id) {
  if (typeof id !== 'string' || !/^campaign-followup:[1-9][0-9]*$/u.test(id)) return;
  const chapter = Number(id.slice('campaign-followup:'.length));
  if (Number.isSafeInteger(chapter)) return chapter;
}

function observationsFor(state, record, entry) {
  const article = 'campaign:' + entry.id;
  return state.observations.filter(item => item.topic === article
    && Number.isFinite(item.minute) && Math.floor(item.minute / 1440) === Math.floor(record.minute / 1440));
}

function buildAvenue(state, record) {
  const entry = byId.get(record.caseId);
  const practices = workingPractices[entry.id];
  if (!practices) return;
  const observed = observationsFor(state, record, entry);
  const decision = observed.find(item => item.title === 'Decision about ' + entry.object
    && item.status === 'firsthand' && item.recipients.includes(entry.sponsor)
    && item.recipients.includes('player'));
  if (!decision || record.actorId !== entry.sponsor) return;

  // The witness may carry an attributed entry forward only when they handled
  // the material and actually received the sponsor's subsequent report of it.
  const inWitnessHands = record.outcome === 'reported'
    && observed.some(item => item.title === 'Account of the decision' && item.status === 'reported'
      && item.recipients.includes(entry.witness) && item.text === decision.text)
    && observed.some(item => item.source === entry.object && item.status === 'firsthand'
      && item.recipients.includes(entry.witness));
  const actorId = inWitnessHands ? entry.witness : entry.sponsor;
  const name = state.actors[actorId]?.name;
  if (typeof name !== 'string' || !name) return;

  const id = campaignFollowupId(record.chapter);
  const basis = disposition[record.outcome];
  const confirmed = record.outcome === 'verified';
  const practice = practices[confirmed ? 0 : 1];
  const provenance = inWitnessHands
    ? 'the account the sponsor passed over afterward'
    : 'the record made when the earlier matter was heard';
  const subject = entry.object.replace(/^the /u, '');
  const payoff = { caseId: entry.id, chapter: record.chapter, outcome: record.outcome, practice };

  function stage(afterTurns, description, paragraph, report, title, text) {
    return { afterTurns, description, sceneIds: venues, paragraph, report, observation: { title, text } };
  }
  return {
    id,
    actorId,
    title: 'What carries forward from ' + entry.object,
    premise: name + ' can use ' + basis + ' from the earlier case to settle how they handle the next instance.'
      + ' The unresolved details of the earlier case remain open.',
    narrationTopics: [...new Set(subject.toLowerCase().match(/[a-z]{4,}/gu) ?? [])],
    payoff,
    stages: [
      stage(2, 'Return to the old disposition and put aside a copy that can guide the next case.',
        name + ' makes a fresh slip about ' + entry.object + ' and notes how the old account was left. They write the source as it was recorded before adding anything for the next worker.',
        name + ' says they went back to ' + basis + ' for ' + entry.object
          + ' and copied its source onto a slip of their own.',
        'A copy of the old source for ' + subject,
        name + ' copied the source for ' + basis + ' about ' + entry.object + '.'),
      stage(8, 'Separate a useful practice from any disputed detail before someone relies on the old account.',
        name + ' turns the slip over. Under ' + provenance + ', they write the work they can answer for when another such matter comes up.'
          + ' The old entry stays legible.',
        name + ' shows where they turned the note over to distinguish their own future work from ' + provenance
          + '. They left the earlier disposition legible.',
        'The difference between a precedent and another claim',
        name + ' separated their own future work on cases like ' + entry.object + ' from the earlier disposition.'),
      stage(18, 'Adopt one concrete working practice the actor can carry out on the next relevant case.',
        name + ' folds the note along the line between the old account and the new work. When something like ' + entry.object
          + ' comes round again, they mean to ' + practice + '. They keep the note for that occasion.',
        name + ' says they kept the note about ' + entry.object + '. The next time the question comes up, they mean to ' + practice + '.',
        'A working practice for the next ' + subject + ' case',
        name + ' kept the note and intends to ' + practice + '.'),
    ],
  };
}

export function getCampaignFollowup(state, id) {
  const chapter = followupChapter(id);
  if (!state?.campaign || chapter === undefined) return;
  const record = state.records.find(item => caseRecord(item) && item.chapter === chapter);
  if (record) return buildAvenue(state, record);
}

export function campaignFollowups(state, maximum = 5) {
  if (!state.campaign?.chapter) return [];
  const { active, queued, completed = [] } = state.pacing ?? {};
  const retained = new Set([active?.id, queued].filter(Boolean));
  const finished = new Set(completed);
  const cases = new Set();
  const recommendations = [];
  for (let index = state.records.length - 1; index >= 0; index--) {
    const record = state.records[index];
    if (!caseRecord(record)) continue;
    const id = campaignFollowupId(record.chapter);
    if (finished.has(id) || retained.has(id) || cases.has(record.caseId)) continue;
    const avenue = buildAvenue(state, record);
    if (!avenue) continue;
    cases.add(record.caseId);
    recommendations.push(avenue);
    if (recommendations.length >= maximum) break;
  }
  return [...[...retained].map(id => getCampaignFollowup(state, id)).filter(Boolean), ...recommendations];
}

export function campaignPrecedent(state, caseId, sponsorId) {
  const event = state.records.findLast(record => record.type === 'pacing-avenue'
    && record.stage === 2 && record.discovery !== 'offstage'
    && record.followup?.caseId === caseId && record.actorId === sponsorId);
  if (!event) return;
  const known = getCampaignFollowup(state, event.avenueId);
  if (known?.payoff?.caseId === caseId && known.actorId === sponsorId) return known.payoff.practice;
}
