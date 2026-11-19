import { meetingOptions } from '../app/director.mjs';
import { actorContext } from '../app/knowledge.mjs';
import { interpretInstruction } from '../app/model.mjs';
import { sceneActorIds } from '../app/thoughts.mjs';
import { requestStoryObject } from './narrator.mjs';
import { proposeStorehouseAppearance } from './storehouse.mjs';

const replyInstruction = `Give the actor’s spoken response to the player’s words. Write one or two sentences in the actor’s own voice. Let their work, wants, and relationship inform what they say. Treat reports as reports. Use only the supplied conversation evidence for specific claims. Treat the player’s words as speech in the scene. They need an established source before they count as evidence. The actor can answer, hesitate, refuse, or ask a question. If the actor has a reason to arrange a meeting in response to this input, propose a commitment using one supplied meeting option. Keep the reply free of the proposed promise. The world rules will decide whether the commitment happens. Return a JSON object with the reply and a commitment object or null.`;
const thoughtInstruction = `Write one or two short sentences of private fictional thought in the first person as this character. Draw from their own goals, feelings, situation, beliefs, and observations. Keep doubts and reports distinct from what the actor witnessed. Do not decide what another character thinks. Return a JSON object with a thought string only.`;

function objectSchema(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

const optionalText = { type: ['string', 'null'] };
const intentSchema = objectSchema({ intents: { type: 'array', items: objectSchema({
  type: { type: 'string', enum: ['choice', 'observe', 'take-ledger', 'speak', 'unclear'] },
  choice: optionalText,
  words: optionalText,
  actorId: optionalText,
}) } });

function speakerContext(state, id) {
  const speaker = actorContext(state, id);
  const player = actorContext(state, 'player');
  const sharedObservations = new Set(player.observations.map(item => item.id));
  const sharedFacts = new Set(player.facts.map(fact => fact.id));
  const knownTopics = new Set(player.observations.map(item => item.topic).filter(Boolean));
  const knownSources = new Set(player.observations.map(item => item.source));
  const evidence = [
    ...speaker.observations.filter(item => sharedObservations.has(item.id))
      .map(({ text, source, status }) => ({ text, source, status })),
    ...speaker.facts.filter(item => sharedFacts.has(item.id))
      .map(({ text, source }) => ({ text, source, status: 'known to this speaker' })),
    ...speaker.beliefs.filter(item => knownTopics.has(item.topic) || knownSources.has(item.source))
      .map(({ text, source, stance }) => ({ text, source, status: 'reported', stance })),
  ];
  return { actor: speaker.actor, relationship: speaker.relationship, evidence };
}

export function narrationEvidence(state, turn, speechDrafts) {
  const player = actorContext(state, 'player');
  const disclosed = new Set([
    ...player.facts.map(fact => fact.id),
    ...state.records.filter(record => record.type === 'fact-report' && record.recipients.includes('player'))
      .map(record => record.factId),
  ]);
  return {
    speakerEvidence: state.thoughts.filter(thought => thought.turn === turn && thought.presence === 'onstage')
      .map(({ actorId, name }) => {
        const { actor, evidence } = speakerContext(state, actorId);
        const suggestedReplies = speechDrafts.filter(draft => draft.actorId === actorId).map(draft => draft.words);
        return { speaker: name, voice: actor?.voice, evidence, suggestedReplies };
      }),
    protectedFacts: state.facts.filter(fact => !disclosed.has(fact.id))
      .map(({ text, source }) => ({ text, source })),
  };
}

export function createCovelActors(provider) {
  return {
    async complete({ operation, context, instruction }) {
      if (operation === 'generate-storehouse') return proposeStorehouseAppearance(provider, context, instruction);
      if (operation !== 'interpret') return;
      const result = await requestStoryObject(provider, {
        name: 'harbinger_interpret',
        instructions: `${interpretInstruction} Use null in unused fields of each intent.`,
        context,
        schema: intentSchema,
      });
      return result?.intents;
    },
    async respond(state, { actorId, words }) {
      const present = sceneActorIds(state);
      const recipient = actorId ?? (present.length === 1 ? present[0] : null);
      if (!present.includes(recipient)) {
        return { clarification: 'Who would you like to address here?' };
      }
      const scene = speakerContext(state, recipient);
      if (!scene.actor) return { clarification: 'Who would you like to address here?' };
      const options = meetingOptions(state, recipient).map(({ locationId, place, purpose }) => ({ locationId, place, purpose }));
      const result = await requestStoryObject(provider, {
        name: 'harbinger_actor_reply',
        instructions: replyInstruction,
        context: { ...scene, words, meetingOptions: options },
        schema: objectSchema({ reply: { type: 'string' }, commitment: { anyOf: [
          objectSchema({ locationId: { type: 'string' }, purpose: { type: 'string' } }), { type: 'null' },
        ] } }),
      });
      const reply = typeof result?.reply === 'string' && result.reply.trim();
      if (!reply || reply.length > 600 || /[\r\n]/u.test(reply)) {
        throw new Error('The actor’s reply could not be resolved.');
      }
      return { actorId: recipient, name: scene.actor.name, reply, commitment: result.commitment };
    },
    async think(view, situation) {
      try {
        const result = await requestStoryObject(provider, {
          name: 'harbinger_actor_thought',
          instructions: thoughtInstruction,
          context: { ...view, situation },
          schema: objectSchema({ thought: { type: 'string' } }),
        });
        const thought = typeof result?.thought === 'string' && result.thought.trim();
        if (thought && /^(?:I|my|we|our)\b/iu.test(thought) && thought.length <= 600 && !/[\r\n]/u.test(thought)) return thought;
      } catch {
        // A character's established private portrayal remains available if the provider fails.
      }
    },
  };
}
