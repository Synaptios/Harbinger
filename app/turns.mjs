import { playFixedTurn, playerView } from './episode.mjs';
import { advanceAgenda, offerMeeting, timeOfDay } from './director.mjs';
import { actorContext, matchConversation, playConversation } from './knowledge.mjs';
import { actorName, recordThoughts, sceneActorIds } from './thoughts.mjs';
import { playGeneratedTurn } from './generated.mjs';
import { stalledModelResult } from './model.mjs';
import { campaignTime } from './campaign.mjs';


const quotation = /(“[^”]*”|"[^"]*")/u;
const spokenFraming = /^\s*(?:i\s+)?(?:say|ask|tell|answer|address|greet|thank|call|speak|whisper)\b/iu;

function actionClauses(text) {
  const clauses = [''];
  text.split(quotation).forEach((part, index) => {
    if (index % 2) {
      clauses[clauses.length - 1] += part;
    } else {
      const [first, ...rest] = part.split(/\s*,?\s+then\s+|\s*;\s*/iu);
      clauses[clauses.length - 1] += first;
      clauses.push(...rest);
    }
  });
  return clauses;
}

function fixedIntents(text, choices) {
  const exact = choices.find(choice => choice.toLowerCase() === text.trim().toLowerCase());
  if (exact) return [{ type: 'choice', choice: exact }];
  return actionClauses(text.trim()).map(step => {
    const [address, quote, trailing, extra] = step.split(quotation);
    if (quote && !extra && /^[\s.!?]*$/u.test(trailing) &&
      (!address.trim() || spokenFraming.test(address) || /[,.!?]\s*$/u.test(address))) {
      return { type: 'speak', words: quote.slice(1, -1) };
    }
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
    location: scene.location, time: scene.id === 'campaign' ? campaignTime(state.minute) : timeOfDay(state.minute), heading, paragraphs, playerText,
  });
}

function verifiedSpeech(state, clauses, words) {
  const present = sceneActorIds(state);
  const candidates = clauses.filter(clause => clause.includes(words));
  const people = [...new Set([...present, ...Object.keys(state.actors ?? {})])].flatMap(id => {
    const name = actorName(state, id)?.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    if (!name) return [];
    return [{
      id,
      command: new RegExp('\\b(?:ask|tell|answer|address|greet|thank|call to|say to|speak to|whisper to|turn to)\\s+'
        + name + '(?=$|[\\s,.:?!])', 'iu'),
      vocative: new RegExp('^\\s*' + name + '\\s*[,!:]', 'iu'),
      turnTo: new RegExp('^\\s*(?:i\\s+)?turn\\s+to\\s+' + name + '\\s*[,.!?]\\s*$', 'iu'),
    }];
  });
  const authorized = [];
  for (const clause of candidates) {
    const spokenClause = clause.split(/\b(?:while|as|and|but)\s+(?:i\s+)?(?:(?:silently|privately|inwardly)\s+)?(?:think|wonder|reflect|consider|remember)\b/iu)[0];
    const [start, ...quotedParts] = clause.split(quotation);
    const quotes = quotedParts.filter((_, index) => index % 2 === 0).map(quote => quote.slice(1, -1));
    const directSpeech = quotes.find(quote => quote.includes(words) || words.includes(quote));
    const framed = spokenFraming.test(start) || (directSpeech && people.some(person => person.turnTo.test(start)));
    const vocative = people.filter(person => person.vocative.test(start) || (directSpeech && person.vocative.test(directSpeech)));
    if (!framed && !vocative.length && !(directSpeech && !start.trim())) continue;
    if (quotes.length && !directSpeech) continue;
    if (!directSpeech && !spokenClause.includes(words)) continue;
    const addressed = new Set([...vocative, ...people.filter(person => person.command.test(start))].map(person => person.id));
    const actorId = addressed.size === 1 ? [...addressed][0] : addressed.size === 0 && present.length === 1 ? present[0] : null;
    if (actorId && present.includes(actorId)) {
      authorized.push({ actorId, words: directSpeech && words.includes(directSpeech) ? directSpeech : words });
    }
  }
  if (authorized.length && authorized.every(item => item.actorId === authorized[0].actorId &&
    item.words === authorized[0].words)) return authorized[0];
}

export async function resolveTurn(save, text, model, { pauseAtDirectorInterruption = false, continueOnUnclear = false } = {}) {
  const snapshot = playerView(save);
  let state = structuredClone(save.state);
  delete state.turn;

  function clarify(message) {
    if (!continueOnUnclear) return { clarification: message };
    const { scene, ended } = playerView({ ...save, state });
    appendMoment(state, scene, ended ? 'The story closes' : 'A moment to decide', [message], text);
    return { state };
  }

  if (snapshot.ended) return clarify('This story has reached an ending.');
  const exact = snapshot.choices.find(choice => choice.toLowerCase() === text.trim().toLowerCase()) ?? matchConversation(save.state, text);
  const audience = model?.respond ? sceneActorIds(save.state).flatMap(id => {
    const name = actorName(save.state, id);
    return name ? [{ id, name }] : [];
  }) : undefined;
  const knownIntents = fixedIntents(text, snapshot.choices);
  const useKnownIntents = !model || (model.respond && knownIntents.every(intent => intent.type !== 'unclear'));
  let intents = exact ? [{ type: 'choice', choice: exact }] : !useKnownIntents
    ? await model.complete({ operation: 'interpret', context: { ...actorContext(save.state, 'player'), text, scene: snapshot.scene, choices: snapshot.choices, audience } })
    : knownIntents;
  const supportedIntents = intents => Array.isArray(intents) && intents.length > 0 && intents.length <= 8;
  if (continueOnUnclear && !supportedIntents(intents)) intents = knownIntents;
  if (!supportedIntents(intents)) return clarify('What would you like to try first?');
  let lastConversation = -1;
  const clauses = actionClauses(text);
  for (const [index, intent] of intents.entries()) {
    if (intent?.type === 'choice' && typeof intent.choice === 'string') {
      const scene = playerView({ ...save, state }).scene;
      const conversation = matchConversation(state, intent.choice);
      if (conversation) {
        const clause = clauses.findIndex((part, offset) => offset > lastConversation &&
          matchConversation(state, part.trim().replace(/^i\s+/iu, '')) === conversation);
        if (clause === -1) return clarify('What would you like to say here?');
        lastConversation = clause;
        await playConversation(state, conversation, scene, model);
        continue;
      }
      const generated = await playGeneratedTurn(state, intent.choice, model);
      if (generated === stalledModelResult) return clarify('The storehouse could not be resolved on this turn.');
      if (generated) continue;
      const previousDirections = state.directorTrace?.length ?? 0;
      const result = await playFixedTurn(state, intent.choice, model?.chooseInspection);
      if (result.clarification) return clarify(result.clarification);
      state = result.state;
      if (pauseAtDirectorInterruption && index < intents.length - 1 && state.directorTrace?.length > previousDirections) {
        state.turn = { kind: 'interrupted' };
        break;
      }
    } else if (intent?.type === 'observe') {
      const scene = playerView({ ...save, state }).scene;
      advanceAgenda(state, state.minute + 2);
      state.records.push({ type: 'observe', minute: state.minute });
      appendMoment(state, scene, 'A moment to look', ['You take a moment to look around.'], 'Look around');
    } else if (intent?.type === 'speak' && typeof intent.words === 'string' && intent.words.trim() && text.includes(intent.words)) {
      const scene = playerView({ ...save, state }).scene;
      const speech = model?.respond ? verifiedSpeech(state, clauses, intent.words) : intent;
      if (!speech) return clarify('Who would you like to address, and what would you like to say aloud?');
      const reply = await model?.respond?.(state, speech, {
        sessionId: save.id, incarnation: save.memoryIncarnation, committedState: save.state,
      });
      if (reply?.clarification) return clarify(reply.clarification);
      advanceAgenda(state, state.minute + 1);
      state.records.push({ type: 'protagonist-speech', minute: state.minute, words: speech.words });
      if (reply) {
        appendMoment(state, scene, 'A word with ' + reply.name, [], '“' + speech.words + '”');
        const passage = state.passages.at(-1);
        state.records.push({ type: 'testimony', actorId: reply.actorId, topic: 'conversation', minute: state.minute, passageId: passage.id });
        const accepted = offerMeeting(state, reply.actorId, reply.commitment, passage);
        if (reply.commitment && !accepted) {
          passage.paragraphs.unshift(`${reply.name} declines to arrange the proposed meeting and stays where the clerk can speak with them.`);
        } else if (reply.grounded && reply.reply) {
          passage.paragraphs.unshift(`${reply.name} says, “${reply.reply}”`);
          state.records.push({
            type: 'actor-exchange', actorId: reply.actorId, minute: state.minute, passageId: passage.id,
            words: speech.words, reply: reply.reply,
          });
        } else {
          passage.paragraphs.unshift(`${reply.name} turns toward the clerk to listen.`);
        }
      } else {
        appendMoment(state, scene, 'Words spoken', ['You speak into the room.'], '“' + speech.words + '”');
      }
    } else if (intent?.type === 'take-ledger' && state.scene === 'bakehouse') {
      advanceAgenda(state, state.minute + 3);
      state.records.push({ type: 'ledger-interruption', minute: state.minute });
      appendMoment(state, playerView({ ...save, state }).scene, 'Alice intervenes', [
        'Alice’s hand comes down on the ledger. “Ask me first,” she says. She leaves her hand there.',
      ], 'Reach for the ledger');
      state.observations.push({
        id: 'observation-' + state.observations.length,
        passageId: state.passages.at(-1).id,
        kind: 'person', title: 'Alice stops the clerk at the ledger',
        text: 'The clerk reached for the ledger. Alice put her hand on it and asked the clerk to ask her first.',
        source: 'At the bakehouse table', status: 'firsthand',
        recipients: ['player', 'alice'], minute: state.minute,
      });
      state.turn = { kind: 'interrupted' };
      break;
    } else {
      return clarify(continueOnUnclear
        ? 'What would you like to try here?'
        : 'What would you like to try here? You can use one of the suggested actions as a starting point.');
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
