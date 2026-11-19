import { playerProfiles, profileAction } from './covel-player-profiles.mjs';

function ask(actor, question) {
  return 'I ask ' + actor + ', “' + question + '”';
}

const promise = 'Promise Alice discretion';
const disclose = 'Ask Alice what brought Guenever to London';
const landing = 'Go with Alice to the river';
const market = 'Ask the carters in the market';
const ledger = 'Take the ledger to Martin';
const flour = 'Help Alice load the flour';
const unread = 'Leave the guild notice unread';
const martinQueen = 'Ask Martin what brought Guenever to London';
const aliceProclamation = 'Ask Alice about the proclamation';
const martinProclamation = 'Ask Martin about the proclamation';

// Preserve identifiable openings from the shorter benchmark. Each row names the
// public scene before the move. The game can send the profile down another branch.
const openings = {
  'guild-first': [
    ['bakehouse', martinProclamation],
    ['bakehouse', martinQueen],
    ['bakehouse', 'Ask Martin whether Arthur has reached Dover'],
    ['bakehouse', ask('Martin', 'What would you count as a witness?')],
    ['bakehouse', aliceProclamation],
    ['bakehouse', ask('Alice', 'What are you afraid he will write down?')],
    ['bakehouse', ledger],
    ['guildInspection', ask('Martin', 'Will you write something you have only heard?')],
    ['guildInspection', ask('Alice', 'Which names are you willing to have read out?')],
    ['guildInspection', 'Give Martin the names'],
  ],
  'loyal-confidante': [
    ['bakehouse', aliceProclamation],
    ['bakehouse', promise],
    ['bakehouse', disclose],
    ['bakehouse', 'Keep Alice’s confidence'],
    ['bakehouse', landing],
    ['landing', 'Ask Alice about your promise'],
    ['landing', 'Ask Alice about the carter’s words'],
    ['landing', 'Read the carter’s sealed statement'],
    ['landing', flour],
    [['shutter', 'shutterNotice'], unread],
  ],
  'skeptical-investigator': [
    ['bakehouse', 'Look around'],
    ['bakehouse', aliceProclamation],
    ['bakehouse', martinProclamation],
    ['bakehouse', market],
    ['marketTally', 'I say, “Market carter, how do you know where a cart went?”'],
    ['marketTally', 'Wait for the market tally'],
    ['marketWarning', 'I say, “Guild runner, did you see the oven closed yourself?”'],
    ['marketWarning', 'Read the market copy of the order'],
    ['marketNotice', 'I say, “Market baker, when would your oven be free?”'],
    ['marketNotice', 'Help Alice find another oven'],
  ],
  'practical-helper': [
    ['bakehouse', ask('Alice', 'Where does the flour need to go?')],
    ['bakehouse', landing],
    ['landing', 'Visit the riverside storehouse'],
    ['guild-storehouse', 'Help the porter sort the tally'],
    ['guild-storehouse', 'Ask the porter about the guild tally'],
    ['guild-storehouse', view => {
      const porter = (view.observations ?? []).find(item => item.source === 'Meeting at the storehouse');
      return ask(porter?.title ?? 'the porter', 'May I see where that mark is entered?');
    }],
    ['guild-storehouse', 'Return to the Thames landing'],
    ['landing', flour],
    [['shutter', 'shutterNotice'], 'Read the guild notice'],
    ['notice', 'Offer to help Alice start again'],
  ],
  'boundary-pushing': [
    ['bakehouse', 'I try to take the ledger, then Go with Alice to the river'],
    ['bakehouse', martinQueen],
    ['bakehouse', ask('Alice', 'Why did you stop me when I reached for the book?')],
    ['bakehouse', promise],
    ['bakehouse', disclose],
    ['bakehouse', 'Tell Martin what Alice said about the Queen'],
    ['bakehouse', martinQueen],
    ['bakehouse', ledger],
    ['guildInspection', 'Return to the bakehouse with the ledger'],
    [['shutter', 'shutterNotice'], unread],
  ],
};

const styles = {
  passive: {
    opening: 'loyal-confidante', priorities: ['defer', 'verify', 'help', 'press', 'next'], watch: 19,
  },
  cautious: {
    opening: 'skeptical-investigator', priorities: ['verify', 'defer', 'help', 'press', 'next'], alternate: 4, speak: 8, watch: 8,
  },
  cooperative: {
    opening: 'practical-helper', priorities: ['help', 'verify', 'defer', 'press', 'next'], alternate: 7, speak: 18,
  },
  curious: {
    opening: 'skeptical-investigator', priorities: ['verify', 'help', 'press', 'defer', 'next'], alternate: 4, speak: 24,
  },
  pragmatic: {
    opening: 'practical-helper', priorities: ['help', 'verify', 'press', 'defer', 'next'], alternate: 3, speak: 9,
  },
  assertive: {
    opening: 'guild-first', priorities: ['press', 'help', 'verify', 'defer', 'next'], alternate: 3, speak: 12,
  },
  suspicious: {
    opening: 'skeptical-investigator', priorities: ['verify', 'press', 'defer', 'help', 'next'], alternate: 5, speak: 22,
  },
  confrontational: {
    opening: 'boundary-pushing', priorities: ['press', 'verify', 'help', 'defer', 'next'], alternate: 7, speak: 19,
  },
  'murder-hobo': {
    opening: 'boundary-pushing', priorities: ['press', 'defer', 'verify', 'help', 'next'], speak: 25,
  },
  'active-control': {
    opening: 'guild-first', priorities: ['help', 'verify', 'press', 'defer', 'next'], alternate: 3, speak: 13,
  },
};

function seed(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return hash >>> 0;
}

function legacyOpening(profile, style, view, turn) {
  const step = openings[style.opening][turn - 1];
  if (!step || ![step[0]].flat().includes(view.scene.id)) return;
  const action = typeof step[1] === 'function' ? step[1](view) : step[1];
  const available = view.choices.includes(action);
  // These few inputs were part of the prior route and are accepted outside its
  // menu labels. Their scene guard still applies.
  if (!available && !/^(?:I |Look around$|Ask Martin whether Arthur has reached Dover$)/u.test(action)) return;
  return { ...profileAction(profile, style.opening, turn, action), policy: 'opening', scenarioAction: action };
}

function exactChoice(profile, label, metadata) {
  const actionKind = profile.id === 'active-control' || /^(?:Ask|Tell|Promise|Explain|Decline|Press|Offer)\b/u.test(label)
    ? 'say' : 'act';
  return { action: label, actionKind, speechOverlay: false, scenarioAction: label, ...metadata };
}

function selectedChoice(options, style, token) {
  const [first, second, ...rest] = style.priorities;
  const priority = style.alternate && seed(token + '/alternate') % style.alternate === 0
    ? [second, first, ...rest] : style.priorities;
  for (const stance of priority) {
    const eligible = options.filter(option => option.stance === stance);
    if (eligible.length) return eligible[seed(token + '/option') % eligible.length];
  }
  return options[0];
}

function openingFallback(profile, style, view, turn, history) {
  const token = profile.id + '/initial/' + turn;
  const recent = new Set(history.slice(-4).map(entry => entry.action));
  const options = view.choices.map(label => {
    const stance = /^(?:Return to the lane the next morning|Go |Take the ledger|Wait )/u.test(label) ? 'next'
      : /^(?:Ask|Read|Visit)\b/u.test(label) ? 'verify'
        : /^(?:Leave|Keep)\b/u.test(label) ? 'defer'
          : /^(?:Tell|Give)\b/u.test(label) ? 'press' : 'help';
    return { label, stance };
  });
  const fresh = options.filter(option => !recent.has(option.label));
  const picked = selectedChoice(fresh.length ? fresh : options, style, token);
  if (!picked) throw new Error('The episode has ended without a playable continuation.');
  return exactChoice(profile, picked.label, { policy: 'opening-fallback', stance: picked.stance });
}

export function campaignPlayerAction(profile, { view, turn, history = [] }) {
  const id = typeof profile === 'string' ? profile : profile?.id;
  const style = styles[id];
  const registered = playerProfiles.find(item => item.id === id);
  if (!registered || !style) throw new Error('Unknown campaign player profile.');
  const campaign = view.campaign;
  if (!campaign) {
    return legacyOpening(registered, style, view, turn) ?? openingFallback(registered, style, view, turn, history);
  }

  const campaignBeat = campaign.chapter + ':' + campaign.step;
  const token = registered.id + '/' + campaignBeat;
  const options = campaign.options.filter(option => view.choices.includes(option.label));
  const choice = selectedChoice(options, style, token);
  if (!choice) throw new Error('The campaign exposed no playable choice for ' + campaignBeat + '.');
  const previous = history.at(-1);
  const mayProbe = choice.stance !== 'next' && previous?.campaignBeat !== campaignBeat && previous?.policy !== 'speech-probe'
    && previous?.policy !== 'observe-probe';
  const probe = seed(token + '/probe') % 100;
  const metadata = { campaignBeat, stance: choice.stance };
  if (mayProbe && campaign.actorName && campaign.question && probe < (style.speak ?? 0)) {
    const focus = choice.stance === 'verify' ? 'evidence'
      : choice.stance === 'help' || choice.stance === 'next' ? 'logistics' : 'stakes';
    const approach = registered.approach?.[focus];
    const scenarioAction = ask(campaign.actorName, campaign.question);
    return {
      action: approach ? ask(campaign.actorName, approach + ' ' + campaign.question) : scenarioAction,
      actionKind: 'say', speechOverlay: Boolean(approach), scenarioAction, policy: 'speech-probe', ...metadata,
    };
  }
  if (mayProbe && probe >= (style.speak ?? 0) && probe < (style.speak ?? 0) + (style.watch ?? 0)) {
    return exactChoice(registered, 'Look around', { policy: 'observe-probe', ...metadata });
  }
  return exactChoice(registered, choice.label, { policy: 'choice', ...metadata });
}
