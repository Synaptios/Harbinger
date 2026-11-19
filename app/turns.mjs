import { playFixedTurn, playerView } from './episode.mjs';
import { advanceAgenda } from './director.mjs';
import { actorContext, matchConversation, playConversation } from './knowledge.mjs';
import { recordThoughts } from './thoughts.mjs';
import { playGeneratedTurn } from './generated.mjs';

function fixedIntents(text, choices) {
  const exact = choices.find(choice => choice.toLowerCase() === text.trim().toLowerCase());
  if (exact) return [{ type: 'choice', choice: exact }];
  return text.trim().split(/\s*,?\s+then\s+|\s*;\s*/i).map(step => {
    const speech = step.match(/^(?:I )?say\s+["“]([^"”]+)["”][.!?]?$/i);
    if (speech) return { type: 'speak', words: speech[1] };
    const words = step.replace(/[.!?]+$/u, '').trim().toLowerCase();
    const choice = choices.find(label => label.toLowerCase() === words);
    if (choice) return { type: 'choice', choice };
    if (/^(i )?(look|glance) around$/u.test(words)) return { type: 'observe' };
    if (/^(i )?(try to )?(take|grab|pick up|reach for) the ledger$/u.test(words)) return { type: 'take-ledger' };
    if (/^(i )?(go|head|leave) (for|to) the river$/u.test(words) && choices.includes('Go with Alice to the river')) {
      return { type: 'choice', choice: 'Go with Alice to the river' };
    }
    return { type: 'unclear' };
  });
}

function appendMoment(state, scene, heading, paragraphs, playerText) {
  state.passages.push({
    id: 'passage-' + state.passages.length,
    location: scene.location, time: scene.time, heading, paragraphs, playerText,
  });
}

async function resolveTurn(save, text, model) {
  const snapshot = playerView(save);
  if (snapshot.ended) return { clarification: 'This story has reached an ending.' };
  const exact = snapshot.choices.find(choice => choice.toLowerCase() === text.trim().toLowerCase()) ?? matchConversation(save.state, text);
  const intents = exact ? [{ type: 'choice', choice: exact }] : model
    ? await model.complete({ operation: 'interpret', context: { ...actorContext(save.state, 'player'), text, scene: snapshot.scene, choices: snapshot.choices } })
    : fixedIntents(text, snapshot.choices);
  if (!Array.isArray(intents) || !intents.length || intents.length > 8) {
    return { clarification: 'What would you like to try first?' };
  }
  let state = structuredClone(save.state);
  delete state.turn;
  for (const intent of intents) {
    if (intent?.type === 'choice' && typeof intent.choice === 'string') {
      const scene = playerView({ ...save, state }).scene;
      if (await playConversation(state, intent.choice, scene, model)) continue;
      if (await playGeneratedTurn(state, intent.choice, model)) continue;
      const result = playFixedTurn(state, intent.choice);
      if (result.clarification) return result;
      state = result.state;
    } else if (intent?.type === 'observe') {
      const scene = playerView({ ...save, state }).scene;
      advanceAgenda(state, state.minute + 2);
      state.records.push({ type: 'observe', minute: state.minute });
      appendMoment(state, scene, 'A moment to look', ['You take a moment to look around.'], 'Look around');
    } else if (intent?.type === 'speak' && typeof intent.words === 'string' && intent.words.trim() && text.includes(intent.words)) {
      const scene = playerView({ ...save, state }).scene;
      advanceAgenda(state, state.minute + 1);
      state.records.push({ type: 'protagonist-speech', minute: state.minute, words: intent.words });
      appendMoment(state, scene, 'Words spoken', ['You speak into the room.'], '“' + intent.words + '”');
    } else if (intent?.type === 'take-ledger' && state.scene === 'bakehouse') {
      advanceAgenda(state, state.minute + 3);
      state.records.push({ type: 'ledger-interruption', minute: state.minute });
      appendMoment(state, snapshot.scene, 'Alice intervenes', [
        'Alice’s hand comes down on the ledger. “Ask me first,” she says. She leaves her hand there.',
      ], 'Reach for the ledger');
      state.turn = { kind: 'interrupted' };
      break;
    } else {
      return { clarification: 'What would you like to try here? You can use one of the suggested actions as a starting point.' };
    }
  }
  return { state };
}

export async function processTurn(store, id, input, model) {
  if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 4000) {
    return { status: 400, body: { message: 'Enter an action of up to 4,000 characters.' } };
  }
  if (typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 128) {
    return { status: 400, body: { message: 'This turn needs a valid request ID.' } };
  }
  const save = store.get(id);
  if (!save) return { status: 404, body: { message: 'Save not found.' } };
  const previous = store.receipt(id, input.requestId);
  if (previous) {
    if (previous.input !== input.text || previous.revision !== input.revision + 1) {
      return { status: 409, body: { message: 'That request ID belongs to a different turn.' } };
    }
    return { status: 200, body: playerView(previous) };
  }
  if (input.revision !== save.revision) {
    return { status: 409, body: { message: 'The save has advanced. Open it again.' } };
  }
  const result = await resolveTurn(save, input.text, model);
  if (result.clarification) return { status: 200, body: result };
  await recordThoughts(save.state, result.state, model, save.revision + 1);
  const committed = store.commit(id, save.revision, result.state, input);
  if (!committed) {
    const receipt = store.receipt(id, input.requestId);
    if (receipt?.input === input.text && receipt.revision === input.revision + 1) {
      return { status: 200, body: playerView(receipt) };
    }
    return { status: 409, body: { message: 'The save has advanced. Open it again.' } };
  }
  return { status: 200, body: playerView(committed) };
}
