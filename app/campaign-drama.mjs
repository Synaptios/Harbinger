import { campaignCases } from './campaign-cases.mjs';

const concerns = {
  bread: ['dawn-share', 'bakers-hour', 'paid-morning', 'wet-fuel'],
  attribution: ['loose-seal', 'blank-witness', 'shutter-copy', 'margin-space'],
  cargo: ['two-notches', 'uneven-sack', 'lost-cord', 'short-measure'],
  obligation: ['yesterdays-entry', 'loaned-peel', 'spare-key', 'lower-step'],
};

const sharedConcern = (left, right) => Object.values(concerns).some(ids => ids.includes(left.id) && ids.includes(right.id));
const sharedActor = (left, right) => [left.sponsor, left.witness].some(id => [right.sponsor, right.witness].includes(id));

function dramaticNextCases(state, current) {
  const { chapter, decision } = state.campaign;
  const last = state.records.findLast(event => event.type === 'campaign-act' && event.chapter === chapter);
  const recent = state.records.filter(event => event.type === 'campaign-opened').slice(-6).map(event => event.caseId);
  const changedHands = last?.stance === 'defer' || decision === 'deferred';
  const candidates = campaignCases.filter(entry => entry.id !== current.id && !recent.includes(entry.id));
  const ranked = candidates.map((entry, index) => {
    const concern = sharedConcern(current, entry);
    const actor = sharedActor(current, entry);
    const samePlace = current.location === entry.location;
    const interest = changedHands ? 3 * Number(!actor) + Number(!samePlace) + Number(concern)
      : Number(concern) * (decision === 'verified' ? 4 : 2)
        + Number(actor) * (decision === 'verified' ? 2 : 4) + Number(!samePlace);
    return { entry, interest, order: (index + chapter) % candidates.length };
  }).sort((a, b) => b.interest - a.interest || a.order - b.order);
  const primary = ranked[0].entry;
  const alternate = ranked.find(({ entry }) => entry.id !== primary.id && entry.sponsor !== primary.sponsor)?.entry;
  return [primary, alternate].filter(Boolean).map((entry, index) => {
    if (changedHands) return { stance: 'next', label: 'Go to hear about ' + entry.object, caseId: entry.id };
    const arrival = index === 0 ? 'verify' : 'help';
    const label = arrival === 'verify' ? 'Go to examine ' + entry.object : 'Go to hear the witness’s account of ' + entry.object;
    return { stance: 'next', label, caseId: entry.id, arrival };
  });
}

export function dramaticOptions(state, entry, followThrough) {
  switch (state.campaign.step) {
    case 1:
      return [
        ['verify', 'Examine ' + entry.object],
        ['help', 'Take down the witness’s account of ' + entry.object],
        ['press', 'Ask the witness what they can answer for'],
        ['defer', 'Leave this matter with those doing the work'],
      ].map(([stance, label]) => ({ stance, label }));
    case 3:
      return [
        ['verify', state.campaign.evidence === 'firsthand' ? 'Enter only the detail you checked'
          : 'Inspect ' + entry.object + ' and enter only what it shows'],
        ['help', state.campaign.evidence === 'reported' ? 'Enter the witness’s account under their name'
          : state.campaign.evidence === 'firsthand' ? 'Help put the checked detail on its own line'
            : 'Leave room for someone who can answer for the entry'],
        ['press', 'Keep the disputed detail out of the account'],
        ['defer', 'Leave the decision with those doing the work'],
      ].map(([stance, label]) => ({ stance, label }));
    case 4:
      return followThrough;
    case 5:
      return dramaticNextCases(state, entry);
    default:
      return [];
  }
}

export function dramaticUnverifiedWork(disposition, stance, entry, name) {
  if (stance === 'defer') {
    return `${name} keeps ${entry.object} to hand. The record of this hearing stays as it stands for whoever takes it up next.`;
  }
  const follow = {
    reported: `${name} leaves the source’s account where someone with firsthand knowledge can compare it. The witness space remains open.`,
    held: `${name} sets the disputed line apart for another hearing. There is still nothing there to charge or clear anyone on.`,
    deferred: `${name} leaves ${entry.object} with the people who already have the work in hand. No new ruling is entered.`,
    provisional: `${name} leaves a space beside the provisional entry for someone who can supply the missing evidence.`,
  };
  return follow[disposition];
}
