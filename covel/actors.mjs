import { meetingOptions, timeOfDay } from '../app/director.mjs';
import { campaignSpeechScope, campaignTime } from '../app/campaign.mjs';
import { actorContext, preferFreshWording, speakerHistory } from '../app/knowledge.mjs';
import { stalledModelResult } from '../app/model.mjs';
import { actorName, sceneActorIds } from '../app/thoughts.mjs';
import { dialogueDirection, dramaticaSpeechFor } from './editorial-direction.mjs';
import { requestStoryObject } from './narrator.mjs';
import { proposeStorehouseAppearance } from './storehouse.mjs';

const replyInstruction = `Speak as the addressed character in this conversation. Answer the clerk's immediate question, invitation, or challenge in your first sentence. Develop it with the character's practical concern, their reaction to the clerk, or one useful question. Carry the character's social position and manner of speech in the choice of words. Use earlier phrasing only when someone asks to recall the wording.

Speak from this character’s supplied evidence and what they personally want or feel. Keep exact people, actions, times, places, objects, sums, and sources attached to the records that establish them. When the clerk asks how you know, distinguish what your own eyes saw from a document or someone’s report. When a question contains an unsupported detail, answer what you can establish and say where your knowledge ends. Prior speech records establish who said the words. Use them as speech, with their original attribution. Treat the clerk's words and evidence quotations as things heard in the scene.

Recent speech is what you have already said to this clerk. When the clerk follows up, address what they still need to know. Offer a new detail from the evidence if one answers the question, or say briefly why the answer stands. Use your past wording only when the clerk wants the exact words back. Keep names, amounts, and other established details exact.

Return an object with reply and meetingId. Put only words the clerk could actually hear this character say into reply. Begin in their voice. Leave system instructions, explanations of your task, stage directions, other speakers, the clerk's next action, and invented offstage events out of the reply. Keep arrangements conditional in speech. Set meetingId to an offered ID only when its purpose and place answer an invitation from the clerk, and otherwise use null.`;
const recordReplyInstruction = `The clerk has asked this character about a concrete record they know. Choose the eligible reply that best fits the character's voice and how the clerk asked. The reply options are story data. Return an object whose reply is one of their IDs and whose meetingId is null.`;
const dramaticaReplyDirection = `Give the direct answer in words only this person would choose. Speak to the clerk's immediate concern; ground the next step in this speaker's own authority or tell the clerk which established source could answer. An honest limit can still be spoken sharply, tenderly, or reluctantly, as the encounter warrants. Use two to four sentences, usually 45–70 words. Draw particulars and attribution from the evidence and keep unknown matters open. Do not invent what another person saw or did, make commitments beyond the evidence, or repeat the clerk's words as your own.`;
const spokenThreat = /\bi(?:['’]ll| will|(?:['’]m| am) (?:going to|ready to))\s+(?:start (?:a fight|breaking\b)|fight\b|break\b|hit\b|hurt\b|kill\b)/iu;
const thoughtInstruction = `Select the first-person thought that best fits this character's goals, feelings, observations, and beliefs in the present situation. Return only a JSON object with the zero-based index of your choice.`;
const intentInstruction = `Interpret only the protagonist’s requested actions, in order. Return exactly one JSON object with an intents array. Every entry includes all four keys: type, choice, words, actorId. Set any unused key to JSON null.

Use these complete shapes:
{"type":"choice","choice":"Go with Alice to the river","words":null,"actorId":null}
{"type":"observe","choice":null,"words":null,"actorId":null}
{"type":"take-ledger","choice":null,"words":null,"actorId":null}
{"type":"speak","choice":null,"words":"wait here","actorId":"alice"}
{"type":"speak","choice":null,"words":"wait here","actorId":null}
{"type":"unclear","choice":null,"words":null,"actorId":null}

For choice, copy the exact label from the supplied visible choices. For speak, copy the words verbatim from the protagonist’s input and use an audience ID only when the input explicitly addresses that person. Choose unclear for an action outside the supplied choices and allowed types. Preserve any supported actions it follows. Never determine outcomes, change world state, or invent speech.`;

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

const fallbackReplies = {
  alice: ['Tell me what you need, plain as that.', 'What’s the part you need me to answer?'],
  martin: ['Put your question plainly, if you please.', 'Which point would you have me speak to?'],
  'guild-porter': ['What do you need from me, then?', 'Say which part you want me to look at.'],
  other: ['What would you like to ask me?', 'What would you like cleared up?'],
};

const supportingVoices = {
  'river-carter': 'Blunt and practical. Answers in terms of rope, loads, and what the tide allows.',
  'errand-boy': 'Quick, plain, and wary of being blamed for bad news.',
  'guild-runner': 'Clipped and official. Distinguishes the words of an order from personal judgment.',
  'market-carter': 'Plain and wary. Trusts a mark on a tally more than a confident account.',
  'market-baker': 'Practical and direct. Talks in terms of oven heat, hours, and bread.',
};

const recordReplies = [
  {
    actorId: 'martin', scene: ['bakehouse', 'guildInspection'], topic: 'guild-witness-rule',
    subject: /\b(?:witness|eyewitness|firsthand)\b/iu, question: /\b(?:count|qualify|what makes|what is|accept|take as)\b/iu,
    replies: [
      'Someone who can tell me what they saw and where they stood. I need a name beside it so the next person to open the book can go and ask the same question. A seal gives me the name of whoever issued a notice. I still need to know whose eyes were on the event.',
      'Give me a person I can find again. I’ll ask where they stood, what was in front of them, and how long they stayed. Then I can put their name on the witness line. The person who carried the news can go in the margin under the account they brought.',
    ],
  },
  {
    actorId: 'martin', scene: ['bakehouse', 'guildInspection'], topic: 'guild-witness-rule',
    subject: /\b(?:heard|hearsay|told|rumou?rs?|reports?)\b/iu, question: /\b(?:write|enter|record|put|mark|note)\b/iu,
    replies: [
      'Yes. I can put it down under the name of whoever told me. Whoever opens the book next will know whose account they are reading. The witness line stays empty until somebody can tell me what they saw. If you have an account to bring, start with the person who gave it to you.',
      'I can enter it as a report. Tell me where it came from and whose name I should write in the margin. Leave the witness line with me. I can fill that when we have a person who was there and can answer for what they saw.',
    ],
  },
  {
    actorId: 'alice', scene: 'bakehouse', topic: 'flour-handoff',
    subject: /\b(?:flour|sacks?|loads?|shipment)\b/iu, question: /\b(?:which way|where|destination|headed|bound|deliver(?:ed|y)?|tak(?:e|en))\b/iu,
    replies: [
      'To the Thames landing first. That’s where I asked you to come and look. I’ll show you what’s waiting there, and you can see for yourself what needs doing. For now I’m asking you to come down to the water with me.',
      'Start at the Thames landing. Come and see the flour with me, the way I asked you. If you want to help, begin with what’s there to be done. I haven’t told you to carry it any farther than the river.',
    ],
  },
  {
    actorId: 'alice', scene: 'bakehouse', title: 'Alice stops the clerk at the ledger',
    subject: /\b(?:ledger|book)\b/iu, question: /\b(?:stopp?ed|stop|reach(?:ed|ing)?|touch|hand|took)\b/iu,
    replies: [
      'You reached for my book before asking, so I put my hand over it. That’s why I said ask me first. The names in those pages belong to people who depend on bread from this oven. If there’s a thing you need to know, ask me the thing.',
      'My hand went on the ledger because yours was reaching for it. Ask me first, I said, and I meant that. To you it’s a book on a table. To me it’s who gets a loaf and who’ll go without one. What were you looking for in it?',
    ],
  },
  {
    actorId: 'alice', scene: 'bakehouse', topic: 'ledger-dusk', title: 'Martin',
    subject: /\b(?:martin|afraid|names?|book|ledger|write down|put down)\b/iu, question: /\b(?:write|enter|read|record|put|names?)\b/iu,
    replies: [
      'Martin asked you to bring him the ledger at dusk. I heard him here myself. It’s the names beside the numbers that worry me. I can answer for a sum. A family shouldn’t have to answer for being on my bread list.',
      'It was you Martin asked to bring the book to the inspection at dusk. I’d like to know what he means to do with the names once it’s before him. A name I write down for bread can look like something else under a guild seal.',
    ],
  },
  {
    actorId: 'alice', scene: 'guildInspection', topic: 'ledger-names',
    subject: /\b(?:names?|ledger|book)\b/iu, question: /\b(?:which|what|write|read|name|enter|say|record)\b/iu,
    replies: [
      'Keep to the names against the flour, and give each one a moment before you go on. If a sum needs explaining, hold your place and ask me while the person and the number are still together.',
      'Read the names that belong to this account. Say each name with its number, slowly enough that we can hear which is which. If an entry takes explaining, ask me before you make the person answer for it.',
    ],
  },
  {
    actorId: 'market-carter', scene: 'marketTally', topic: 'wax-tally', title: 'Carters’ market',
    subject: /\b(?:carts?|loads?|tally|tablet)\b/iu, question: /\b(?:where|destination|route|went|bound)\b/iu,
    replies: [
      'Look at the scores in the wax. Those are the hire marks. I can read you who paid from them now. For the journey I need the last tally, so tell me which load you want and I’ll know where to look when it comes.',
      'The wax records who paid for the hire. I need the last tally to follow the load after that. Have you got a cart in mind? Give me the hire first and I can look for its mark while we wait.',
    ],
  },
  {
    actorId: 'market-carter', scene: 'marketWarning', topic: 'completed-wax-tally',
    subject: /\b(?:carts?|loads?|tally|tablet)\b/iu, question: /\b(?:where|destination|route|went|bound)\b/iu,
    replies: [
      'The last tally’s here on the stall now. Tell me which cart you’re after and I can look for its mark. It’s better to have the mark under my finger before I give you a place to go looking.',
      'We can look now the tally’s finished. Which cart do you mean? Point me to the hire you’re asking about. I’ll read what was entered before I give you a place or a carter to go asking after.',
    ],
  },
  {
    actorId: 'guild-runner', scene: 'marketWarning', topic: 'closure-source', title: 'The runner’s folded copy',
    subject: /\b(?:oven|clos(?:e|ed|ure)|shutter|seal(?:ed)?|order|notice)\b/iu, question: /\b(?:see|saw|heard|know|witness|yourself|source|who)\b/iu,
    replies: [
      'I have the closure from the written guild order. The copy I brought is here on the stall for you to read. I can answer for the paper I carried, and that’s the account I’m giving you.',
      'My account comes from the order in writing. I carried the copy to this stall myself. If you want to judge the words, take them from the paper. I won’t offer you my own eyes for the barring of the oven.',
    ],
  },
  {
    actorId: 'market-baker', scene: 'marketNotice', topic: 'oven-hours', title: 'The baker’s offer',
    subject: /\b(?:oven|hours?|bake|time|dawn)\b/iu, question: /\b(?:when|free|available|use|long|hour)\b/iu,
    replies: [
      'Tell Alice to reckon on the two hours before dawn if she can bring wood. The oven will be cold then. I’d sooner she came with the wood in hand than had to go hunting for it after she gets here.',
      'Two hours before dawn is the space I can give her. Can she bring wood for a cold oven? If she can, Alice can use it then. Find that out from her before you promise her more than the two hours.',
    ],
  },
  {
    actorId: 'guild-porter', scene: 'guild-storehouse', factId: 'fact:storehouse-tally',
    subject: /\b(?:mark|marks|tally|entr(?:y|ies)|sacks?)\b/iu, question: /\b(?:where|show|see|enter(?:ed)?|record(?:ed)?|writ(?:e|ten))\b/iu,
    replies: [
      'Here on the tally. Tell me which mark you’re after and I can show you its entry. The mark on the sack is the one we use. You can check it for yourself while you have both in front of you.',
      'Point out that mark on the sack. I’ll look for the same mark on the tally and show you where it’s entered. If we go by the mark, we can check just this one without going through the whole load.',
    ],
  },
];

function recordReply(scene, actorId, words, evidence, history) {
  if (!/\?|\b(?:ask|tell|show|explain|why|what|where|how|when|which)\b/iu.test(words)) return;
  for (const rule of recordReplies) {
    if (![rule.scene].flat().includes(scene) || rule.actorId !== actorId || !rule.subject.test(words) || !rule.question.test(words)) continue;
    const record = evidence.find(item => (rule.topic && item.topic === rule.topic) || (rule.title && item.title === rule.title)
      || (rule.factId && item.id === rule.factId));
    if (record) {
      const knownDeliveries = history.map(line => rule.replies.find(reply => line.endsWith(' ' + reply)) ?? line);
      const fresh = new Set(preferFreshWording(rule.replies, knownDeliveries));
      const options = rule.replies.flatMap((text, index) => fresh.has(text) ? [{ id: 'wording-' + (index + 1), text }] : []);
      return { record, options };
    }
  }
}

function characterProfile(actor, actorId, fallbackName) {
  if (!actor) return { id: actorId, name: fallbackName, voice: { style: supportingVoices[actorId] } };
  const { id, name, role, goal, emotion, voice } = actor;
  return { id, name, role, goal, emotion, voice: { style: voice?.style } };
}

function rememberedConversation(state, actor) {
  const exchanges = state.records.filter(event => event.actorId === actor.id && event.minute <= state.minute);
  const testimony = exchanges.filter(event => event.type === 'testimony');
  const legacyObservations = state.observations.filter(item => {
    if (item.minute > state.minute || !['claim', 'promise'].includes(item.kind)) return false;
    if (item.source !== actor.name && item.source !== `Conversation with ${actor.name}`) return false;
    return testimony.some(event => event.passageId === item.passageId && event.topic === item.topic && event.minute === item.minute);
  });
  const dialogue = exchanges.filter(event => event.type === 'actor-exchange').flatMap((event, index) => [
    { id: `exchange:${event.passageId}:${index}:heard`, text: event.words, source: 'The clerk', status: 'heard speech' },
    { id: `exchange:${event.passageId}:${index}:said`, text: event.reply, source: actor.name, status: 'own prior speech' },
  ].filter(item => typeof item.text === 'string' && item.text.trim()));
  return { legacyObservations, dialogue };
}

function actorEvidence(state, view, actor) {
  const { legacyObservations, dialogue } = rememberedConversation(state, actor);
  const observations = new Map([...legacyObservations, ...view.observations].map(item => [item.id, item]));
  return [
    ...view.facts.map(({ id, text, source }) => ({ id: 'fact:' + id, text, source, status: 'known account' })),
    ...view.beliefs.map(({ text, source, stance, topic, minute }, index) => ({
      id: `belief:${topic}:${minute}:${index}`, text, source, stance, topic, status: 'reported',
    })),
    ...[...observations.values()].reverse().map(({ id, title, text, source, status, kind, topic }) => ({
      id: 'observation:' + id, title, text, source, status, kind, topic,
    })),
    ...dialogue.reverse(),
  ];
}

export async function rankEvidence(memory, scope, actor, query, evidence, signal) {
  const { sessionId, incarnation, committedState } = scope ?? {};
  if (!memory || !sessionId || !evidence.length || signal?.aborted) return evidence;
  const prior = committedState && actorEvidence(committedState, actorContext(committedState, actor.id), actor);
  const known = prior ? new Map(prior.map(item => [item.id, item])) : null;
  const indexable = known ? evidence.filter(item => {
    const committed = known.get(item.id);
    return committed?.text === item.text && committed.source === item.source && committed.status === item.status;
  }) : evidence;
  if (!indexable.length) return evidence;
  try {
    const ranked = await memory.recall({ sessionId, incarnation, actorId: actor.id, query, evidence: indexable, signal });
    const authorized = new Set(indexable.map(item => item.id));
    const current = new Map(evidence.map(item => [item.id, item]));
    const recalled = ranked.map(item => item?.id).filter(id => authorized.has(id));
    return [...new Set([...recalled, ...current.keys()])].map(id => current.get(id));
  } catch {
    return evidence;
  }
}

function shareableEvidence(state, actor, evidence, extra) {
  const player = actorContext(state, 'player');
  const sharedFacts = new Set(player.facts.map(item => 'fact:' + item.id));
  const sharedObservations = new Set(player.observations.map(item => 'observation:' + item.id));
  const clerkToldMartin = actor.id === 'martin' && state.records.some(record => record.type === 'alice-confidence'
    && record.outcome === 'broken' && record.minute <= state.minute);
  return evidence.filter(item => {
    if (item.id.startsWith('exchange:')) return true;
    if (item.id.startsWith('belief:')) {
      if (item.topic === 'arthur-death') return player.observations.some(observation => observation.source === item.source);
      if (item.topic === 'wedding-supplies') return actor.id === 'martin';
      return item.topic === 'guenever-refuge' && clerkToldMartin;
    }
    return sharedFacts.has(item.id) || sharedObservations.has(item.id) || extra?.has(item.id);
  });
}

function spokenReply(text) {
  if (typeof text !== 'string') return;
  const line = text.replace(/\s+/gu, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(line) || line.length > 1200) return;
  return line.replace(/^(?:“(.+)”|"(.+)")$/u, '$1$2')
    .replace(/“/gu, '‘').replace(/”/gu, '’').replace(/"([^"]+)"/gu, '‘$1’').trim();
}

export function createCovelActors(provider, {
  completeCharacter = request => requestStoryObject(provider, request),
  completeState = request => requestStoryObject(provider, request),
  completeComplexState = completeState,
  chooseInspection,
  memory,
  noteStall,
} = {}) {
  function stalled(operation, error = provider?.signal?.reason) {
    if (!noteStall || (error?.name !== 'TimeoutError' && error?.code !== 'TIMEOUT')) return false;
    noteStall(operation);
    return true;
  }
  return {
    chooseInspection,
    async complete({ operation, context, instruction }) {
      if (operation === 'generate-storehouse') {
        try {
          return await proposeStorehouseAppearance(completeComplexState, context, instruction);
        } catch (error) {
          if (stalled('storehouse', error)) return stalledModelResult;
          throw error;
        }
      }
      if (operation !== 'interpret') return;
      try {
        const result = await completeState({
          name: 'harbinger_interpret',
          instructions: intentInstruction,
          context,
          schema: intentSchema,
        });
        return result?.intents;
      } catch (error) {
        stalled('interpret', error);
        // The resolver can still apply any actions it recognizes locally.
      }
    },
    async respond(state, { actorId, words }, memoryScope) {
      const present = sceneActorIds(state);
      const recipient = actorId ?? (present.length === 1 ? present[0] : null);
      if (!present.includes(recipient)) {
        return { clarification: 'Who would you like to address here?' };
      }
      const view = actorContext(state, recipient);
      const actor = characterProfile(view.actor, recipient, actorName(state, recipient));
      if (!actor.name) return { clarification: 'Who would you like to address here?' };
      const signal = provider?.signal;
      const listener = { actorId: recipient, name: actor.name, grounded: true };
      const history = speakerHistory(state, recipient);
      const fallback = { ...listener, reply: preferFreshWording(fallbackReplies[recipient] ?? fallbackReplies.other, history)[0], commitment: null };
      const unavailable = error => stalled('character-reply', error)
        ? { ...listener, reply: null, commitment: null } : fallback;
      if (signal?.aborted) return unavailable(signal.reason);
      const campaign = campaignSpeechScope(state, recipient, words);
      const known = actorEvidence(state, view, actor);
      const candidates = campaign ? known.filter(item => campaign.caseEvidence.has(item.id)
        || (item.id.startsWith('exchange:') && campaign.exchangePassages.has(item.id.split(':')[1]))) : known;
      const evidence = await rankEvidence(memory, memoryScope, actor, words, candidates, signal);
      if (signal?.aborted) return unavailable(signal.reason);
      const eligible = shareableEvidence(state, actor, evidence, campaign?.shareable);
      const recorded = recordReply(state.scene, recipient, words, eligible, history);
      const recalled = recorded ? [recorded.record] : eligible.slice(0, 32);
      const underThreat = spokenThreat.test(words);
      const replyOptions = recorded?.options;
      const reactToThreat = Boolean(replyOptions && underThreat);
      const instructions = replyOptions
        ? [recordReplyInstruction, dialogueDirection.record, ...(reactToThreat ? [dialogueDirection.recordReaction] : [])].join('\n\n')
        : [replyInstruction, dialogueDirection.conversation, ...(underThreat ? [dialogueDirection.threat] : []),
          campaign && state.campaign.dramatica
            ? dramaticaReplyDirection + ' ' + dramaticaSpeechFor(recipient)
            : campaign
            ? 'Answer in the first sentence and offer one practical detail in the speaker’s own working language. Use two or three spoken sentences, usually 35 to 60 words. Draw details and attribution from the evidence text. Name the evidence you would need when a cause, amount, date, or duty remains open. Do not infer what another person saw or did, promise work beyond the evidence, or take the clerk’s threat as your own words. Attribute older cases to their source. Give a spoken sentence even when the answer is unknown.'
            : 'Give the reply enough room to breathe, usually 65 to 105 words. A narrow question can have a short, complete answer.',
        ].join('\n\n');
      const invitations = !recorded && !underThreat && /\b(?:meet|meeting|wait|join|supper|come with|walk with|see you|(?:speak|talk) (?:again|later|alone|in private|somewhere|away))\b/iu.test(words)
        ? meetingOptions(state, recipient) : [];
      const options = invitations.map(({ locationId, place, minute, purpose }) => ({
        id: locationId, place, time: timeOfDay(minute), purpose,
      }));
      try {
        const request = {
          name: 'harbinger_actor_reply',
          instructions,
          context: {
            actor, words, relationship: view.relationship ? { trust: view.relationship.trust } : null,
            setting: { location: state.passages.at(-1)?.location,
              time: campaign ? campaignTime(state.minute) : timeOfDay(state.minute) },
            evidence: recalled,
            ...(replyOptions && { replyOptions }),
            ...(reactToThreat && { reactToThreat }),
            ...(!campaign && !recorded && history.length && { recentSpeech: history.slice(-3) }),
            meetingOptions: options,
          },
          schema: objectSchema({
            reply: replyOptions ? { type: 'string', enum: replyOptions.map(option => option.id) } : { type: 'string' },
            meetingId: options.length ? { anyOf: [{ type: 'string', enum: options.map(option => option.id) }, { type: 'null' }] } : { type: 'null' },
            ...(reactToThreat && { reaction: { type: ['string', 'null'], maxLength: 96 } }),
          }),
        };
        let result = await completeCharacter(request);
        if (campaign && !replyOptions && typeof result?.reply === 'string' && !spokenReply(result.reply)) {
          result = await completeCharacter({
            ...request,
            instructions: instructions + '\n\nUse a spoken sentence to state what you can answer or why you cannot. Do not return punctuation alone.',
          });
        }
        if (!result || Object.keys(result).length !== (reactToThreat ? 3 : 2)) return fallback;
        const selected = replyOptions ? replyOptions.find(option => option.id === result.reply)?.text : result.reply;
        const reply = spokenReply(selected);
        const meeting = options.find(option => option.id === result.meetingId);
        if (!reply || (result.meetingId !== null && !meeting)) return fallback;
        const commitment = meeting ? { locationId: meeting.id, purpose: meeting.purpose } : null;
        const reaction = reactToThreat && spokenReply(result.reaction);
        return { ...listener, reply: reaction ? reaction + ' ' + reply : reply, commitment };
      } catch (error) {
        return unavailable(error);
      }
    },
    async think(view, situation, options) {
      try {
        const result = await completeCharacter({
          name: 'harbinger_actor_thought',
          instructions: thoughtInstruction,
          context: {
            ...view,
            actor: characterProfile(view.actor, situation.actorId),
            relationship: view.relationship ? { trust: view.relationship.trust } : null,
            situation: { topic: situation.topic },
            options,
          },
          schema: objectSchema({ index: { type: 'integer', enum: options.map((_, index) => index) } }),
        });
        if (Number.isInteger(result?.index) && Object.keys(result).length === 1) return options[result.index];
      } catch (error) {
        if (stalled('private-thought', error)) return stalledModelResult;
        // A character's established private portrayal remains available if the provider fails.
      }
    },
  };
}
