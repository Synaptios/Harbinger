import { actorContext } from './knowledge.mjs';

const sceneActors = {
  bakehouse: ['alice', 'martin'],
  landing: ['alice', 'river-carter'],
  shutter: ['alice', 'errand-boy'],
  notice: ['alice'],
  firstLight: ['alice'],
  laneDepart: ['alice'],
  marketTally: ['alice', 'market-carter'],
  marketWarning: ['guild-runner', 'market-carter'],
  marketNotice: ['market-baker'],
  marketOven: ['alice', 'market-baker'],
  marketDepart: ['alice'],
};

const names = {
  alice: 'Alice', martin: 'Martin', 'river-carter': 'River carter', 'errand-boy': 'Errand boy',
  'guild-runner': 'Guild runner', 'market-carter': 'Market carter', 'market-baker': 'Market baker',
};

function participants(before, state) {
  const people = new Map();
  const mark = (actorId, presence, minute, source, topic) => {
    if (!actorId || actorId === 'player' || (people.get(actorId)?.minute ?? -1) > minute) return;
    people.set(actorId, { actorId, presence, minute, source, topic });
  };
  const newPassages = state.passages.slice(before?.passages.length ?? 0);
  const newestPassage = newPassages.at(-1);
  for (const passage of newPassages) {
    for (const actorId of sceneActors[passage.sceneId] ?? []) {
      mark(actorId, 'onstage', passage.minute, passage.heading, passage.sceneId);
    }
  }
  for (const event of state.records.slice(before?.records.length ?? 0)) {
    const source = newPassages.find(passage => passage.id === event.passageId)?.heading ?? newestPassage?.heading ?? 'Current turn';
    if (event.type === 'testimony' || event.type === 'generated-encounter') {
      mark(event.actorId, 'onstage', event.minute, source, event.topic);
    } else if (event.type === 'ledger-interruption') {
      mark('alice', 'onstage', event.minute, 'Alice stops the clerk at the ledger', 'ledger');
    } else if (event.type === 'inspection' && event.outcome === 'oven-sealed') {
      mark('martin', 'offstage', event.minute, 'Guild inspection at dusk', 'inspection');
      for (const affected of event.sources ?? []) {
        if (!people.has(affected.actorId)) mark(affected.actorId, 'offstage', event.minute, affected.detail, 'inspection');
      }
      if (newPassages.some(passage => passage.sceneId === 'shutter')) {
        mark('river-carter', 'onstage', event.minute, 'Loading the flour at the landing', 'loading');
      }
    }
  }
  return [...people.values()];
}

function optionsFor(role, view) {
  const authored = {
    alice: [
      'I can let them take the flour. I cannot let them read the names.',
      'I’ll count the cost after I know whose bread I can still bake.',
    ],
    martin: role.topic === 'inspection' ? [
      'I gave them until the dusk bell. I’ll put down what I found and sign the order myself.',
      'I have to answer for the missing stock. I’ll sign my own name to the closure.',
    ] : [
      'I need an account I can put my name to. A blank line is better than a false sum.',
      'I can answer for what I’ve seen. I’ll keep a separate line for everything I’ve only heard.',
    ],
    'errand-boy': ['I’ll find Alice with the key. I hope she has somewhere else to bake.'],
    'guild-runner': ['I was told to carry the order to the market. I’ll leave the paper where they can read it.'],
    'river-carter': ['I want the sacks aboard before the tide turns. I’ll pull the cover tight.'],
    'market-carter': ['I’ll finish the marks on the tally before I answer for another cart.'],
    'market-baker': ['I can spare two hours at my oven. I’ll need someone to bring wood.'],
    'guild-porter': ['I have to keep track of what crosses this threshold. I’ll ask what the clerk needs.'],
  };
  const sources = [role.source];
  if (role.topic === 'arthur-death') {
    const account = view.beliefs.find(belief => belief.topic === role.topic);
    if (account) {
      const line = account.stance === 'doubts'
        ? 'I heard what the crier said. I’ll wait for someone who saw it before I call it true.'
        : 'I take the crier’s report seriously. I have to decide what the guild does under that account.';
      return { lines: [line], sources: [...sources, account.source] };
    }
  }
  const phrase = role.actorId === 'alice' && view.facts.find(fact => fact.id === 'carter-phrase');
  if (phrase) {
    const recollection = ` I still remember what the carter said. “${phrase.text}”`;
    return { lines: authored.alice.map(line => line + recollection), sources: [...sources, phrase.source] };
  }
  return { lines: authored[role.actorId] ?? ['I’ll weigh what I saw before deciding what to do.'], sources };
}

async function chooseThought(model, view, lines) {
  if (!model || lines.length === 1) return lines[0];
  try {
    const choice = await model.complete({
      operation: 'actor-thought',
      instruction: 'Select an authored first-person thought from this actor’s point of view. Return a JSON object with its zero-based index. Select only among the offered lines.',
      context: { actor: view.actor, facts: view.facts, beliefs: view.beliefs, observations: view.observations, options: lines },
    });
    if (Number.isInteger(choice?.index) && lines[choice.index]) return lines[choice.index];
  } catch {
    // The authored first line is always available.
  }
  return lines[0];
}

function draftThoughts(before, state, revision) {
  return participants(before, state).map(role => {
    const view = actorContext({ ...state, minute: role.minute }, role.actorId);
    const { lines, sources } = optionsFor(role, view);
    return { view, lines, entry: {
      turn: revision, minute: role.minute, actorId: role.actorId,
      name: view.actor?.name ?? names[role.actorId] ?? role.actorId,
      presence: role.presence, text: lines[0], sources,
    } };
  });
}

export function seedThoughts(state) {
  state.thoughts = draftThoughts(null, state, 0).map(draft => draft.entry);
  return state;
}

export async function recordThoughts(before, state, model, revision) {
  const entries = await Promise.all(draftThoughts(before, state, revision).map(async ({ view, lines, entry }) => ({
    ...entry, text: await chooseThought(model, view, lines),
  })));
  state.thoughts ??= [];
  state.thoughts.push(...entries);
  for (const direction of (state.directorTrace ?? []).slice(before.directorTrace?.length ?? 0)) {
    direction.turn = revision;
  }
}

export function testingView(save) {
  return {
    revision: save.revision,
    thoughts: save.state.thoughts ?? [],
    directions: (save.state.directorTrace ?? []).map(({ turn, situation, reason }) => ({ turn, situation, reason })),
  };
}
