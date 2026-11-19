export const title = 'The Bread Ledger';
export const worldVersion = 'malory-everymans-book-xxi.v1';

const scenes = {
  bakehouse: {
    heading: 'Alice’s bakehouse', location: 'London · Bakehouse lane', time: 'Dawn',
    paragraphs: [
      'A crier’s voice carries through the flour dust. The proclamation says Arthur died fighting Launcelot overseas. Alice sets a loaf upside down to cool. She keeps working after the voice has gone.',
      'Martin, the guild officer, rests the delivery book beside the scales. “At dusk. This book, a pair of honest totals, and I can keep the ovens open.”',
      'When the door shuts, Alice wipes her hands on her apron. “I stood surety for you once. I won’t ask you to owe me. Come to the river and look at what’s waiting there.”',
    ],
    choices: ['Go with Alice to the river'],
    observation: { kind: 'claim', title: 'The proclamation', text: 'The crier says Arthur died fighting Launcelot overseas.', source: 'London crier', status: 'reported' },
  },
  landing: {
    heading: 'Thames landing', location: 'London · Thames landing', time: 'Late afternoon',
    paragraphs: [
      'A carter folds a tarpaulin over the last sack. On the landing the river has left a line of wet leaves, each one facing downstream.',
      '“Six sacks,” Alice says. “Enough to keep them on their feet. I know what six sacks are worth. I’m asking you what the names beside them are worth.”',
    ],
    choices: ['Help Alice load the flour'],
    observation: { kind: 'place', title: 'Thames landing', text: 'Six sacks of flour wait at the landing.', source: 'Seen at the landing', status: 'firsthand' },
  },
  shutter: {
    heading: 'A key at dusk', location: 'London · Bakehouse lane', time: 'Dusk',
    paragraphs: [
      'You steady the sacks while the carter settles the load. The last one goes over as the dusk bell sounds.',
      'A boy finds you at the mouth of the lane and presses Alice’s key into her palm. He says Martin ordered the oven sealed while you were away. He saw a written order pinned to the shutter.',
    ],
    choices: ['Read the guild notice'],
    observation: { kind: 'claim', title: 'The oven may be sealed', text: 'An errand boy says Martin ordered Alice’s oven sealed.', source: 'Errand boy', status: 'reported' },
  },
  notice: {
    heading: 'The order on the shutter', location: 'London · Alice’s bakehouse', time: 'Dusk',
    paragraphs: [
      'A nail through the seal holds the paper flat. The guild’s order confirms the inspection went ahead. No ledger was produced. The oven is to stay closed until the missing stock is accounted for.',
      'Alice lifts the key to the familiar lock. She turns it over in her hand and waits.',
    ],
    choices: ['Offer to help Alice start again'],
    observation: { kind: 'clue', title: 'Guild closure order', text: 'No ledger was produced at the inspection. The guild has ordered the oven closed until the stock is accounted for.', source: 'Written order on the bakehouse', status: 'firsthand' },
  },
  firstLight: {
    heading: 'The price of flour', location: 'London · Alice’s bakehouse', time: 'After dusk',
    paragraphs: [
      'The flour is on its way to the Tower. The names are still in the book. Behind the shutter, the oven is going cold.',
      'Alice slips the key into her pocket. “Come at first light. You can carry the wood. I’ll see about an oven.”',
    ],
    choices: [],
    observation: { kind: 'promise', title: 'Return at first light', text: 'The clerk offered to help Alice start again and she asked them to return at first light.', source: 'Conversation with Alice', status: 'firsthand' },
  },
};

const route = {
  bakehouse: { next: 'landing', minute: 1020 },
  landing: { next: 'shutter', minute: 1080 },
  shutter: { next: 'notice', minute: 1080 },
  notice: { next: 'firstLight', minute: 1100 },
};

function visit(state, scene, playerText) {
  const view = scenes[scene];
  const passageId = 'passage-' + state.passages.length;
  state.scene = scene;
  state.passages.push({ id: passageId, ...view, playerText });
  state.observations.push({
    id: 'observation-' + state.observations.length,
    passageId,
    ...view.observation,
    recipients: ['player'],
  });
}

export function startEpisode() {
  const state = {
    worldVersion,
    minute: 360,
    pending: [{ type: 'inspection', minute: 1080 }],
    records: [{ type: 'episode-start', minute: 360 }],
    facts: [
      { id: 'forged-letters', text: 'Mordred commissioned the letters that reported Arthur’s death.', recipients: ['mordred'], source: 'Malory XXI.I' },
      { id: 'carter-phrase', text: 'The blue loaf wakes at low tide.', recipients: ['alice'], source: 'The Tower carter told Alice at the landing.' },
    ],
    passages: [],
    observations: [],
  };
  visit(state, 'bakehouse', null);
  return state;
}

export function playFixedTurn(state, text) {
  const current = scenes[state.scene];
  if (!current.choices.some(choice => choice.toLowerCase() === text.trim().toLowerCase())) {
    return { clarification: current.choices.length ? 'Choose the available action to continue this route.' : 'This story has reached an ending.' };
  }
  const result = structuredClone(state);
  const move = route[state.scene];
  result.minute = move.minute;
  const due = result.pending.filter(event => event.minute <= result.minute);
  result.pending = result.pending.filter(event => event.minute > result.minute);
  result.records.push({ type: 'player-action', text, minute: result.minute }, ...due);
  visit(result, move.next, text);
  return { state: result };
}

export function playerView(save) {
  const { state } = save;
  const { heading, location, time, choices } = scenes[state.scene];
  return {
    id: save.id, name: save.name, revision: save.revision,
    title, worldVersion: state.worldVersion,
    scene: { id: state.scene, heading, location, time },
    passages: state.passages.map(({ id, heading, location, time, playerText, paragraphs }) =>
      ({ id, heading, location, time, playerText, paragraphs })),
    observations: state.observations
      .filter(observation => observation.recipients.includes('player'))
      .map(({ recipients, ...visible }) => visible),
    choices, ended: choices.length === 0,
  };
}
