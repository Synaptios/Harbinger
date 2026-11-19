import { advanceAgenda } from './director.mjs';

const characters = {
  alice: {
    id: 'alice', name: 'Alice', goal: 'Keep her apprentice fed and the families on her delivery list safe.',
    emotion: 'guarded but practical',
    voice: { style: 'Short, concrete, and rooted in baking and debts people actually pay.', examples: ['Six sacks. Enough to keep them on their feet.', 'You can carry the wood. I’ll see about an oven.'] },
  },
  martin: {
    id: 'martin', name: 'Martin', goal: 'Keep enough licensed ovens open to feed the lane under the new officials.',
    emotion: 'watchful and pressed for time',
    voice: { style: 'Formal, counted, and careful about whose name goes next to a claim.', examples: ['This book, a pair of honest totals, and I can keep the ovens open.', 'Enter the date before you enter the sum.'] },
  },
};

const proclamation = {
  topic: 'arthur-death', text: 'The proclamation says Arthur died fighting Launcelot overseas.',
  source: 'London crier', minute: 360,
};
const openingBeliefs = [
  { ...proclamation, actorId: 'alice', stance: 'doubts' },
  { ...proclamation, actorId: 'martin', stance: 'believes' },
];

export function initialKnowledge() {
  return {
    actors: structuredClone(characters),
    beliefs: structuredClone(openingBeliefs),
    relationships: [
      { from: 'alice', to: 'player', trust: 0 },
      { from: 'martin', to: 'player', trust: 0 },
    ],
  };
}

export function visibleObservations(state, actorId) {
  return state.observations.filter(item => item.recipients.includes(actorId) && (item.minute ?? 0) <= state.minute)
    .map(({ recipients, minute, ...visible }) => visible);
}

export function actorContext(state, actorId) {
  const actor = (state.actors ?? characters)[actorId] ?? null;
  return {
    actor,
    facts: state.facts.filter(fact => fact.recipients.includes(actorId) && (fact.availableFrom ?? 0) <= state.minute)
      .map(({ id, text, source }) => ({ id, text, source })),
    beliefs: (state.beliefs ?? openingBeliefs).filter(belief => belief.actorId === actorId && belief.minute <= state.minute)
      .map(({ actorId, ...belief }) => belief),
    observations: visibleObservations(state, actorId),
    relationship: state.relationships?.find(item => item.from === actorId && item.to === 'player') ?? null,
  };
}

const proclamationOptions = {
  doubts: [
    'Alice wipes the flour off her hands. “I heard what they read. Ink and a loud voice cost less than a witness.”',
    'Alice turns a loaf on its board. “A crier reads what he’s paid to read. I never stood beside Arthur where they say he fell.”',
  ],
  believes: [
    'Martin straightens the edge of the ledger. “The proclamation says he fell against Launcelot. I take a sealed notice seriously.”',
    'Martin taps the date on his tally. “Arthur’s death was proclaimed under seal. The guild must act on the account we have.”',
  ],
};

const dialogueActions = {
  aliceProclamation: 'Ask Alice about the proclamation',
  martinProclamation: 'Ask Martin about the proclamation',
  martinQueen: 'Ask Martin what brought Guenever to London',
  promise: 'Promise Alice discretion',
  aliceQueen: 'Ask Alice what brought Guenever to London',
  keep: 'Keep Alice’s confidence',
  tell: 'Tell Martin what Alice said about the Queen',
  remember: 'Ask Alice about your promise',
};

function confidence(state) {
  return state.records.findLast(event => event.type === 'alice-confidence');
}

export function conversationChoices(state) {
  const promise = confidence(state);
  if (state.scene === 'landing' && promise && ['kept', 'broken'].includes(promise.outcome)) return [dialogueActions.remember];
  if (state.scene !== 'bakehouse') return [];
  if (!promise) return [dialogueActions.aliceProclamation, dialogueActions.martinProclamation, dialogueActions.martinQueen, dialogueActions.promise];
  if (promise.outcome === 'promised') return [dialogueActions.aliceQueen, dialogueActions.martinQueen];
  if (promise.outcome === 'trusted') return [dialogueActions.keep, dialogueActions.tell];
  return [dialogueActions.remember, dialogueActions.martinQueen];
}

async function chooseLine(model, context, topic, options) {
  if (!model || options.length === 1) return options[0];
  try {
    const result = await model.complete({
      operation: 'actor-reply',
      instruction: 'Select one of the offered portrayal options for this actor. Return only {"index":0} or {"index":1}. Use the supplied viewpoint and never invent words or outcomes.',
      context: { ...context, topic, options },
    });
    if (Number.isInteger(result?.index) && result.index >= 0 && result.index < options.length) return options[result.index];
  } catch {
    // The authored reply keeps the encounter playable if the provider fails.
  }
  return options[0];
}

function dialogueFor(state, action) {
  const promise = confidence(state);
  switch (action) {
    case dialogueActions.aliceProclamation:
    case dialogueActions.martinProclamation: {
      const actorId = action === dialogueActions.aliceProclamation ? 'alice' : 'martin';
      const context = actorContext(state, actorId);
      const belief = context.beliefs.findLast(item => item.topic === proclamation.topic);
      return { actorId, heading: context.actor.name + ' on the proclamation', topic: proclamation.topic, options: proclamationOptions[belief?.stance] ?? proclamationOptions.doubts };
    }
    case dialogueActions.martinQueen: {
      const account = actorContext(state, 'martin').beliefs.find(item => item.topic === 'guenever-refuge');
      return {
        actorId: 'martin', heading: 'The guild’s account', topic: 'guenever-refuge',
        options: [account
          ? 'Martin draws a separate line in the margin. “I’ll enter the Tower as the clerk’s account. Bring me someone who saw her before I put it among the facts.”'
          : 'Martin turns a page of his tally. “Wedding supplies are the only business I have on record.”'],
      };
    }
    case dialogueActions.promise:
      return { actorId: 'alice', heading: 'Between the two of you', topic: 'confidence', kind: 'promise', outcome: 'promised', options: ['Alice rests both hands on the flour board. “Between the two of us, then. Let him get out into the lane first.”'] };
    case dialogueActions.aliceQueen:
      return { actorId: 'alice', heading: 'The reason for the flour', topic: 'guenever-refuge', outcome: 'trusted', options: ['Alice waits until Martin goes out. “The carter saw Guenever at the Tower. She took refuge in the Tower. The wedding errands were the excuse.”'] };
    case dialogueActions.keep:
      return { actorId: 'alice', heading: 'A name left out', topic: 'confidence', kind: 'promise', outcome: 'kept', options: ['When Martin comes back to ask after the shipment, you keep the route to yourself. Alice moves the bread past him and leaves a heel on your plate.'] };
    case dialogueActions.tell:
      return { actorId: 'alice', heading: 'A name entered', topic: 'confidence', kind: 'promise', outcome: 'broken', options: ['You tell Martin that Alice’s carter saw Guenever take refuge in the Tower. The pen stops moving for a moment. Alice lays the bread knife flat beside his book.'] };
    case dialogueActions.remember:
      return { actorId: 'alice', heading: 'What Alice remembers', topic: 'confidence', kind: 'promise', options: [promise.outcome === 'kept'
        ? 'Alice lifts the cloth off the small loaf. “You kept your word when Martin pressed you. Walk with me to the landing again tomorrow.”'
        : 'Alice folds the flour cloth into a narrow square. “I heard you tell him. Next time I’ll send my boy to carry the message.”'] };
  }
}

export async function playConversation(state, choice, scene, model) {
  if (!conversationChoices(state).includes(choice)) return false;
  const { actorId, heading, topic, options, kind = 'claim', outcome } = dialogueFor(state, choice);
  const context = actorContext(state, actorId);
  const line = await chooseLine(model, context, topic, options);
  advanceAgenda(state, state.minute + 1);
  const passageId = 'passage-' + state.passages.length;
  state.passages.push({ id: passageId, heading, location: scene.location, time: scene.time, paragraphs: [line], playerText: choice });
  state.observations.push({
    id: 'observation-' + state.observations.length,
    passageId, kind, title: heading, text: line,
    source: kind === 'promise' ? 'Conversation with Alice' : context.actor.name,
    status: kind === 'promise' ? 'firsthand' : 'reported', topic, recipients: ['player'], minute: state.minute,
  });
  state.records.push({ type: 'testimony', actorId, topic, minute: state.minute, passageId });
  if (outcome) {
    const outcomeRecord = { type: 'alice-confidence', outcome, minute: state.minute, passageId };
    state.records.push(outcomeRecord);
    if (outcome === 'kept' || outcome === 'broken') {
      state.relationships ??= initialKnowledge().relationships;
      const relation = state.relationships.find(item => item.from === 'alice' && item.to === 'player');
      relation.trust = outcome === 'kept' ? 1 : -1;
      relation.source = passageId;
    }
    if (outcome === 'broken') {
      state.beliefs ??= structuredClone(openingBeliefs);
      state.beliefs.push({ actorId: 'martin', topic: 'guenever-refuge', text: 'The clerk says Alice’s carter saw Guenever take refuge in the Tower.', source: 'Clerk’s testimony heard in the bakehouse', stance: 'reported', minute: state.minute });
    }
  }
  return true;
}
