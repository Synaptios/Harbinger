import { advanceAgenda, selectInspectionConsequence } from './director.mjs';
import { conversationChoices, initialKnowledge, visibleObservations } from './knowledge.mjs';
import { generatedChoices, generatedScene } from './generated.mjs';

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
    choices: ['Go with Alice to the river', 'Ask the carters in the market'],
    observation: { kind: 'claim', title: 'The proclamation', text: 'The crier says Arthur died fighting Launcelot overseas.', source: 'London crier', status: 'reported' },
    additionalObservations: [
      { kind: 'person', title: 'Alice', text: 'Alice is the baker who once stood surety for the clerk.', source: 'Conversation at the bakehouse', status: 'firsthand' },
      { kind: 'person', title: 'Martin', text: 'Martin is the guild officer who asked the clerk to bring the ledger to the inspection at dusk.', source: 'Conversation at the bakehouse', status: 'firsthand' },
    ],
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
    choices: ['Read the guild notice', 'Leave the guild notice unread'],
    observation: { kind: 'claim', topic: 'oven-closure', title: 'The oven may be sealed', text: 'An errand boy says Martin ordered Alice’s oven sealed.', source: 'Errand boy', status: 'reported' },
  },
  notice: {
    heading: 'The order on the shutter', location: 'London · Alice’s bakehouse', time: 'Dusk',
    paragraphs: [
      'A nail through the seal holds the paper flat. The guild’s order confirms the inspection went ahead. No ledger was produced. The oven is to stay closed until the missing stock is accounted for.',
      'Alice lifts the key to the familiar lock. She turns it over in her hand and waits.',
    ],
    choices: ['Offer to help Alice start again'],
    observation: { kind: 'clue', confirms: 'oven-closure', title: 'Guild closure order', text: 'No ledger was produced at the inspection. The guild has ordered the oven closed until the stock is accounted for.', source: 'Written order on the bakehouse', status: 'firsthand' },
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
  laneDepart: {
    heading: 'The long way home', location: 'London · Bakehouse lane', time: 'After dusk',
    paragraphs: [
      'Alice pockets the key, then walks past the shutter. “My boy has supper at my sister’s,” she says. “I’d best catch them while there’s some left.”',
      'The paper is still hanging from the shutter when the two of you turn out of the lane.',
    ],
    choices: [],
    observation: { kind: 'person', title: 'Alice’s supper plans', text: 'Alice says her apprentice is eating supper with her sister.', source: 'Conversation on the bakehouse lane', status: 'reported' },
  },
  marketTally: {
    heading: 'The market tally', location: 'London · Carters’ market', time: 'Late afternoon',
    paragraphs: [
      'A carter at the market measures out the afternoon’s loads against the score marks on a wax tablet. “I can tell you who paid for a cart. I need the last tally to tell you where it went.”',
      'Alice recognizes the mark for flour beside a cart she used last week. She turns her head as if someone has said her name, but the market is still bargaining around her.',
    ],
    choices: ['Wait for the market tally'],
    observation: { kind: 'place', title: 'Carters’ market', text: 'The carters keep a tally of their hired carts.', source: 'Seen in the carters’ market', status: 'firsthand' },
  },
  marketWarning: {
    heading: 'A warning by the stall', location: 'London · Carters’ market', time: 'Dusk',
    paragraphs: [
      'The carter sets the completed tally on the stall just as a guild runner comes down the lane. He asks the carters to show him their delivery marks.',
      '“The guild has closed Alice’s oven,” he says. “Her apprentice buys her bread here. Tell her that one more unpaid loaf will go on his tally.” He leaves a folded copy of the order on the stall.',
    ],
    choices: ['Read the market copy of the order', 'Leave the market copy unread'],
    observation: { kind: 'claim', topic: 'oven-closure', title: 'Closure reported at the market', text: 'A guild runner says Alice’s oven has been closed.', source: 'Guild runner', status: 'reported' },
  },
  marketNotice: {
    heading: 'The folded order', location: 'London · Carters’ market', time: 'Dusk',
    paragraphs: [
      'The guild’s seal has cracked where the runner folded the paper. No ledger was produced at the inspection. The order closes Alice’s oven until the stock can be accounted for.',
      'A baker at the next stall is sweeping flour into his hand. He glances at the order. “Mine goes cold two hours before dawn,” he says. “She could have those two hours, if she can bring wood.”',
    ],
    choices: ['Help Alice find another oven'],
    observation: { kind: 'clue', confirms: 'oven-closure', title: 'Guild closure order', text: 'No ledger was produced at the inspection. The order closes Alice’s oven until the stock is accounted for.', source: 'Guild copy left at the market stall', status: 'firsthand' },
  },
  marketOven: {
    heading: 'Two hours before dawn', location: 'London · Carters’ market', time: 'After dusk',
    paragraphs: [
      'The baker turns his chalkboard over and writes Alice’s name beside the hours. It is a small space, and he leaves her room for three dozen loaves.',
      'Alice reads the board twice. “Tell my boy the first one is his,” she says. Then she asks where they can get dry wood.',
    ],
    choices: [],
    observation: { kind: 'promise', title: 'Two hours at another oven', text: 'A market baker has set aside two hours for Alice to use his oven before dawn.', source: 'Market baker’s chalkboard', status: 'firsthand' },
  },
  marketDepart: {
    heading: 'After the market', location: 'London · Carters’ market', time: 'After dusk',
    paragraphs: [
      'A stallholder weighs the folded paper down with a stone as the market closes. The carters’ tally goes into a different pocket.',
      'Alice pulls her shawl close. “Walk me as far as the corner,” she says. “My boy will be looking for me.”',
    ],
    choices: [],
    observation: { kind: 'person', title: 'Alice heads home from the market', text: 'Alice leaves the carters’ market to see her apprentice.', source: 'Conversation at the carters’ market', status: 'firsthand' },
  },
};

const route = {
  'Go with Alice to the river': { next: 'landing', minute: 1020 },
  'Help Alice load the flour': { next: 'shutter', minute: 1080, locationId: 'bakehouse-lane' },
  'Read the guild notice': { next: 'notice', minute: 1080 },
  'Leave the guild notice unread': { next: 'laneDepart', minute: 1100 },
  'Offer to help Alice start again': { next: 'firstLight', minute: 1100 },
  'Ask the carters in the market': { next: 'marketTally', minute: 1015 },
  'Wait for the market tally': { next: 'marketTally', minute: 1088, locationId: 'market' },
  'Read the market copy of the order': { next: 'marketNotice', minute: 1088 },
  'Leave the market copy unread': { next: 'marketDepart', minute: 1105 },
  'Help Alice find another oven': { next: 'marketOven', minute: 1105 },
};

function visit(state, scene, playerText) {
  const view = scenes[scene];
  const passageId = 'passage-' + state.passages.length;
  state.scene = scene;
  state.passages.push({ id: passageId, ...view, playerText, sceneId: scene, minute: state.minute });
  for (const { confirms, ...observation } of [view.observation, ...(view.additionalObservations ?? [])]) {
    const prior = confirms && state.observations.findLast(item => item.topic === confirms && item.status === 'reported');
    state.observations.push({
      id: 'observation-' + state.observations.length,
      passageId,
      ...observation,
      ...(prior ? { supersedes: prior.id } : {}),
      recipients: ['player'],
      minute: state.minute,
    });
  }
}

export function startEpisode() {
  const state = {
    ...initialKnowledge(),
    worldVersion,
    minute: 360,
    pending: [{ type: 'inspection', minute: 1080 }],
    records: [{ type: 'episode-start', minute: 360 }],
    directorTrace: [],
    facts: [
      { id: 'forged-letters', text: 'Mordred commissioned the letters that reported Arthur’s death.', recipients: ['mordred'], source: 'Malory XXI.I' },
      { id: 'carter-phrase', text: 'The blue loaf wakes at low tide.', recipients: ['alice'], source: 'The Tower carter told Alice at the landing.' },
      { id: 'guenever-refuge', text: 'Guenever took refuge in the Tower and used shopping for the proposed wedding as a pretext.', recipients: ['alice'], source: 'The Tower carter saw Guenever; the court’s public errand was wedding supplies.', availableFrom: 360 },
      { id: 'dover-landing', text: 'Arthur has landed at Dover.', recipients: [], source: 'Malory XXI.II', availableFrom: 1440 },
    ],
    passages: [],
    observations: [],
  };
  visit(state, 'bakehouse', null);
  return state;
}

export function playFixedTurn(state, text) {
  const current = scenes[state.scene];
  if (!current && generatedScene(state)) {
    return { clarification: 'This storehouse only opens onto the path to the Thames landing.' };
  }
  const choice = current.choices.find(choice => choice.toLowerCase() === text.trim().toLowerCase());
  if (!choice) {
    return { clarification: current.choices.length ? 'Choose the available action to continue this route.' : 'This story has reached an ending.' };
  }
  const result = structuredClone(state);
  const move = route[choice];
  advanceAgenda(result, move.minute);
  result.records.push({ type: 'player-action', text, minute: result.minute });
  const consequence = move.locationId && selectInspectionConsequence(result, move.locationId);
  visit(result, consequence ?? move.next, text);
  return { state: result };
}

export function playerView(save) {
  const { state } = save;
  const { heading, location, time, choices } = scenes[state.scene] ?? generatedScene(state);
  const offeredChoices = [...choices, ...conversationChoices(state), ...generatedChoices(state)];
  return {
    id: save.id, name: save.name, revision: save.revision,
    title, worldVersion: state.worldVersion,
    scene: { id: state.scene, heading, location, time, minute: state.minute },
    turn: state.turn ?? null,
    passages: state.passages.map(({ id, heading, location, time, playerText, paragraphs }) =>
      ({ id, heading, location, time, playerText, paragraphs })),
    observations: visibleObservations(state, 'player'),
    choices: offeredChoices, ended: offeredChoices.length === 0,
  };
}
