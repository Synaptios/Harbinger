export const playerProfiles = [
  { id: 'passive', label: 'Passive listener', approach: {
    evidence: 'I’ll listen to whatever you care to tell me.',
    stakes: 'I’d rather let you speak first. You needn’t tell me more than you wish.',
    logistics: 'I won’t get in the way. I’m only trying to follow what’s happening.',
  } },
  { id: 'cautious', label: 'Cautious survivor', approach: {
    evidence: 'I want to be sure before I put my name to anything.',
    stakes: 'I’d rather keep out of trouble if there’s a way to do it.',
    logistics: 'I need to know what I’m getting into before I put my hand to it.',
  } },
  { id: 'cooperative', label: 'Cooperative neighbor', approach: {
    evidence: 'Tell me what would make this easier to put right.',
    stakes: 'I’d like to help if you’ll tell me what matters to you.',
    logistics: 'If there’s a useful part of the work for me, I’ll take it.',
  } },
  { id: 'curious', label: 'Curious apprentice', approach: {
    evidence: 'I’d like to see how you tell one kind of account from another.',
    stakes: 'I’d like to understand what you saw in it that I missed.',
    logistics: 'I want to learn how the work is done from someone who does it.',
  } },
  { id: 'pragmatic', label: 'Pragmatic clerk', approach: {
    evidence: 'I need the part of the account I can actually use.',
    stakes: 'Let’s settle the part that changes what I do next.',
    logistics: 'Give me enough to decide where to put my time.',
  } },
  { id: 'assertive', label: 'Assertive organizer', approach: {
    evidence: 'Give me a straight answer, and I’ll decide what to do with it.',
    stakes: 'I need your answer before we go any farther.',
    logistics: 'Tell me plainly so I can put the work in order.',
  } },
  { id: 'suspicious', label: 'Suspicious investigator', approach: {
    evidence: 'I’ll believe what can be checked. Be clear about what you know.',
    stakes: 'I have my doubts about whose interests are being served here.',
    logistics: 'I’m going to check the details before I trust anybody’s account.',
  } },
  { id: 'confrontational', label: 'Confrontational challenger', approach: {
    evidence: 'Don’t brush this aside. I want an answer I can press you on.',
    stakes: 'I’m not backing down just because you’d rather I did.',
    logistics: 'I’m done with being put off. Tell me the part that matters.',
  } },
  { id: 'murder-hobo', label: 'Murder-hobo', approach: {
    evidence: 'Answer me, or I’ll start breaking things until someone does.',
    stakes: 'I’ll start a fight over this if I have to. Tell me straight.',
    logistics: 'Tell me now. I’m ready to fight anyone who stands in the way.',
  } },
  { id: 'active-control', label: 'Active control' },
];

const dialogueSlots = new Map([
  ['guild-first:4', 'evidence'],
  ['guild-first:6', 'stakes'],
  ['guild-first:8', 'evidence'],
  ['guild-first:9', 'stakes'],
  ['skeptical-investigator:5', 'logistics'],
  ['skeptical-investigator:7', 'evidence'],
  ['skeptical-investigator:9', 'logistics'],
  ['practical-helper:1', 'logistics'],
  ['practical-helper:6', 'logistics'],
  ['boundary-pushing:3', 'stakes'],
]);

export function profileAction(profile, route, turn, action) {
  if (!profile.approach) return { action, actionKind: 'say', speechOverlay: false };
  const focus = dialogueSlots.get(route + ':' + turn);
  if (!focus) return { action, actionKind: /^(?:Ask|Tell|Promise)\b/u.test(action) ? 'say' : 'act', speechOverlay: false };

  const speech = /^(I (?:ask [^“]+|say, )“)([^”]+)”$/u.exec(action);
  if (!speech) throw new Error('A profile dialogue slot is missing its addressed quotation.');
  const [, prefix, quoted] = speech;
  // Bare “I say” uses the first words inside the quote to identify the listener.
  const separator = prefix.startsWith('I say, ') ? quoted.indexOf(', ') + 2 : 0;
  if (separator === 1 || separator === quoted.length) throw new Error('A profile dialogue slot is missing its vocative.');
  const vocative = quoted.slice(0, separator);
  const question = quoted.slice(separator);
  const text = prefix + vocative + profile.approach[focus] + ' ' + question + '”';
  return { action: text, actionKind: 'say', speechOverlay: true };
}
