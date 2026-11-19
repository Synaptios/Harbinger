import { getCampaignFollowup } from './campaign-followups.mjs';

const verifiedWork = {
  'dawn-share': ['Check where to mark the next dawn collection',
    'sets the tally out with the two lines visible. The next dawn mark can go in its own line as soon as a loaf is collected.'],
  'loose-seal': ['Check the seal beside its written description',
    'sets the folded permit beside the new description of the wax and leaves the person who stamped it unnamed.'],
  'two-notches': ['Check the two receipts beside their own hire entries',
    'sets the receipts out beside their separate entries so the notch for each hire is ready to be checked against a charge.'],
  'wet-fuel': ['Check the dry wood set aside for the first firing',
    'sets the dry pieces apart for the first firing and leaves the account of the wet wood open.'],
  'blank-witness': ['Check where an eyewitness could add a name',
    'keeps the carrier’s report beside the open eyewitness space. Anyone who saw the notice will have a separate place to answer for it.'],
  'uneven-sack': ['Check the handoff mark before the usable flour moves',
    'sets the sack with its handoff mark in view so the next person can check it against the entry before moving the usable flour.'],
  'bakers-hour': ['Check the separate turns for the two trays',
    'sets out the chalkboard with the main batch listed before the later tray. The later firing still depends on the oven cooling.'],
  'yesterdays-entry': ['Check the receiving line on the delivery slip',
    'sets the slip beside the entry for when it reached the runner. The earlier journey still has a line of its own.'],
  'loaned-peel': ['Check what can be mended on the borrowed peel',
    'sets the peel where the loose handle can be worked on while the record of the loan stays in place.'],
  'lost-cord': ['Check what can be saved for the next tag comparison',
    'keeps the written description beside the tag so anyone with a receipt can compare both the remaining stroke and the part that wore away.'],
  'spare-key': ['Check which line covers the errand for the key',
    'sets the register open at the errand entry so it can be read on its own. The line for keeping the room stays separate.'],
  'short-measure': ['Check the measure before it is used again',
    'sets the repaired measure out for the next comparison. The old delivery sum stays as it was.'],
  'shutter-copy': ['Check the hours on the public copy',
    'sets the copy of the public hours aside for posting and keeps the runner’s own instruction with the original.'],
  'paid-morning': ['Check where the paid loaf will be marked on collection',
    'keeps the paid loaf set aside with its collection space open on the slate. The rest of the bread stays available.'],
  'lower-step': ['Check the two hours written on the boat receipt',
    'sets the receipt out at the separate arrival and signing entries so anyone weighing the unloading can see which hour answers which question.'],
  'margin-space': ['Check that a named correction has a line of its own',
    'keeps the page open at the two separate lines. The old attribution stays legible and the next person can give a correction under their own name.'],
};

const otherWork = {
  reported: ['help', 'Ask to keep the named account ready for someone who can witness it',
    'sets the account with its source attached where it can be compared if somebody brings a firsthand account. The name already on it stays with the report.'],
  held: ['press', 'Ask to put the disputed line aside with its source',
    'sets the disputed line aside with its source noted so someone bringing support can find it again. It stays outside the account.'],
  deferred: ['defer', 'Leave the decision with those involved and keep the earlier note to hand',
    'keeps the earlier note with the papers still in hand. The people doing the work keep responsibility for the decision.'],
  provisional: ['verify', 'Check where the missing proof can be added to the open entry',
    'keeps a separate line open for whoever brings the missing proof. The provisional entry is still open.'],
};

export const campaignVerifiedWork = caseId => verifiedWork[caseId];

export function campaignPractice(state, entry, disposition) {
  const { chapter, step, evidence } = state.campaign ?? {};
  if (state.scene !== 'campaign' || step !== 4 || chapter < 2) return;
  const work = disposition === 'verified' && evidence === 'firsthand' && verifiedWork[entry.id]
    ? ['verify', ...verifiedWork[entry.id]] : otherWork[disposition];
  if (!work) return;

  const decision = state.records.findLast(record => record.type === 'campaign-act' && record.step === 3
    && record.chapter === chapter && record.caseId === entry.id && record.actorId === entry.sponsor);
  if (decision?.outcome !== disposition) return;
  const decisionSource = state.observations.findLast(item => item.topic === 'campaign:' + entry.id
    && item.title === 'Decision about ' + entry.object && item.minute === decision.minute
    && item.status === 'firsthand' && item.recipients.includes(entry.sponsor) && item.recipients.includes('player'));
  if (!decisionSource) return;

  const used = new Set(state.records.flatMap(record => record.work?.precedentId ?? []));
  for (let index = state.records.length - 1; index >= 0; index--) {
    const event = state.records[index];
    const payoff = event.followup;
    if (event.type !== 'pacing-avenue' || event.stage !== 2 || !['witnessed', 'reported'].includes(event.discovery)
        || used.has(event.avenueId) || payoff?.caseId !== entry.id || payoff.outcome !== disposition
        || payoff.chapter >= chapter || ![entry.sponsor, entry.witness].includes(event.actorId)) continue;
    const precedent = getCampaignFollowup(state, event.avenueId);
    if (precedent?.actorId !== event.actorId || precedent.payoff.chapter !== payoff.chapter
        || precedent.payoff.outcome !== disposition || precedent.payoff.practice !== payoff.practice) continue;
    const proof = precedent.stages.at(-1).observation;
    const source = state.observations.findLast(item => item.topic === 'pacing:' + event.avenueId
      && item.title === proof.title && item.text === proof.text && item.minute <= state.minute
      && item.status === (event.discovery === 'reported' ? 'reported' : 'firsthand')
      && item.recipients.includes('player') && item.recipients.includes(event.actorId));
    if (!source) continue;

    const [stance, label, action] = work;
    return {
      stance, label, text: state.actors[event.actorId].name + ' ' + action,
      actorId: event.actorId, title: 'Work carried forward on ' + entry.object,
      record: { precedentId: event.avenueId, precedentSourceId: source.id, decisionSourceId: decisionSource.id,
        actorId: event.actorId, disposition },
    };
  }
}
