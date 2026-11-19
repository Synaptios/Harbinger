import { actorContext } from '../app/knowledge.mjs';
import { rankEvidence } from './actors.mjs';
import { dramaticaSpeechFor } from './editorial-direction.mjs';

export const campaignReactionMaxWords = 45;
const minimumWords = 24;
const dramaticMaxWords = 63;
const dispositions = new Set(['verified', 'reported', 'held', 'deferred', 'provisional']);
const schema = {
  type: 'object', properties: { speech: { type: 'string' } },
  required: ['speech'], additionalProperties: false,
};
const instructions = `Speak as this person in The Bread Ledger after the clerk takes an action. Begin with the one detail, decision, or piece of work in resultEvidence that you can answer for. Give one usable limit or condition in the language of your trade. For a held, deferred, or provisional entry, say what is still open or who can answer for it from your evidence. When a named practice has just happened, speak about that work and leave the wider case where it stands.

Use your trade to choose words. Take facts and consequences from the supplied evidence. Attribute reports to their source. Keep offers and proposed work pending. Do not invent a cost, debt, fine, withheld wage, license, duty, act, sighting, speech, or agreement. Do not speak for the clerk or treat their menu label as speech. Return one JSON object whose speech field contains two or three spoken sentences, 24–45 words, without a name, quotation marks, or stage directions.`;
const dramaticInstructions = `Speak as the identified person in The Bread Ledger. Respond to the clerk's action. Take your position in your first words, with one reason drawn from resultEvidence or otherEvidence. If you heard a report, give its source. Let an open question stay open. Do not invent a debt, new event, person, proof, commitment, or another speaker's words. Write up to three sentences, around 25–55 words. Return only the words this person speaks without a label, quotation marks, markup, or stage directions. `;

const wordCount = text => text.split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;

export function campaignReactionBudget(plan) {
  return plan ? (plan.dramatica ? dramaticMaxWords : campaignReactionMaxWords) + wordCount(plan.actorName + ' says,') : 0;
}

function reactionPhase(move, state) {
  if (move.step === 4 && move.work) return 'practice';
  if (move.step === 2 && move.stance === 'verify' && state.campaign.evidence === 'firsthand') return 'comparison';
  if (move.step === 3 && dispositions.has(move.outcome)) return 'decision';
  if (move.step === 4 && ['verify', 'press'].includes(move.stance) && dispositions.has(move.disposition)) return 'follow-through';
}

function evidenceFor(state, move, actorId) {
  const topic = 'campaign:' + move.caseId;
  const day = Math.floor(move.minute / 1440);
  const scope = state.observations.filter(item => item.topic === topic && item.minute <= move.minute
    && Math.floor(item.minute / 1440) === day);
  const disclosed = new Set(scope.filter(item => item.recipients.includes('player')).map(item => item.text));
  // A person can restate the same disclosed detail with their own source.
  // This does not let an unpublished fact enter the scene through dialogue.
  return scope.filter(item => item.recipients.includes(actorId) && disclosed.has(item.text));
}

const projection = ({ title, text, source, status }) => ({ title, text, source, status });

export function planCampaignReaction(state, { firstRecord, passages }) {
  const passage = passages.at(-1);
  if (state.scene !== 'campaign' || !passage?.playerText || !Number.isInteger(firstRecord)) return;
  const events = state.records.slice(firstRecord);
  if (events.some(record => record.type === 'actor-exchange')) return;
  const move = events.findLast(record => (record.type === 'campaign-act' || record.dramaticBeat) && record.passageId === passage.id);
  if (!move || move.chapter !== state.campaign.chapter) return;
  const beat = state.campaign.dramatica && move.dramaticBeat;
  const actorId = beat?.speakerId ?? move.work?.actorId ?? move.actorId;
  if (!passage.actorIds?.includes(actorId)) return;
  const phase = beat?.kind ?? reactionPhase(move, state);
  if (!phase) return;
  const { actor, relationship } = actorContext(state, actorId);
  if (!actor?.name) return;
  const evidence = evidenceFor(state, move, actorId);
  const anchor = evidence.findLast(item => {
    if (beat) return beat.sourceIds.includes(item.id) && item.text === beat.effect;
    if (phase === 'practice') return item.status === 'firsthand' && item.title.startsWith('Work carried forward on ');
    if (phase === 'decision') return item.status === 'firsthand' && item.title.startsWith('Decision about ');
    if (phase === 'follow-through') return item.status === 'reported' && item.title === 'Account of the decision';
    return item.status === 'firsthand'
      && (item.title === 'Evidence reviewed alongside the account' || item.title.startsWith('Evidence about '));
  });
  if (!anchor) return;
  const supportingEvidence = evidence.filter(item => item !== anchor && item.text !== anchor.text).slice(-4)
    .map(item => ({ id: 'observation:' + item.id, ...projection(item) }));
  const plan = {
    actorId, actorName: actor.name, minute: move.minute, passageId: passage.id, supportingEvidence, dramatica: Boolean(beat),
    context: {
      campaignReaction: true,
      actor, ...(relationship && { trust: relationship.trust }),
      setting: { location: passage.location, time: passage.time },
      action: { label: passage.playerText, phase, stance: move.stance,
        disposition: beat?.decision ?? (phase === 'decision' ? move.outcome : move.disposition ?? null) },
      resultEvidence: projection(anchor),
      otherEvidence: supportingEvidence.slice(0, 2).map(projection),
    },
  };
  const canonicalWords = passages.reduce((sum, item) => sum + item.paragraphs.reduce((total, line) => total + wordCount(line), 0), 0);
  if (canonicalWords + campaignReactionBudget(plan) <= 300) return plan;
}

export async function writeCampaignReaction(plan, { complete, signal, noteStall, memory, memoryScope }) {
  if (!plan) return;
  signal?.throwIfAborted();
  try {
    const ranked = await rankEvidence(memory, memoryScope, plan.context.actor, plan.context.action.label, plan.supportingEvidence, signal);
    signal?.throwIfAborted();
    const result = await complete({
      name: 'harbinger_campaign_reaction', instructions: plan.dramatica ? dramaticInstructions + dramaticaSpeechFor(plan.actorId) : instructions,
      context: { ...plan.context, otherEvidence: ranked.slice(0, 2).map(projection) },
      ...(plan.dramatica && { response: 'speech' }),
      schema, maxOutputTokens: plan.dramatica ? 148 : 108,
    });
    const speech = typeof result?.speech === 'string' ? result.speech.trim() : '';
    const length = wordCount(speech);
    if (length >= (plan.dramatica ? 8 : minimumWords) && length <= (plan.dramatica ? dramaticMaxWords : campaignReactionMaxWords)) {
      return { actorId: plan.actorId, actorName: plan.actorName, passageId: plan.passageId, minute: plan.minute, speech };
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (error.name === 'TimeoutError' || error.code === 'TIMEOUT') noteStall?.('campaign-reaction');
  }
}

export function publishCampaignReaction(state, reaction) {
  if (!reaction || !state.passages.some(passage => passage.id === reaction.passageId && passage.actorIds?.includes(reaction.actorId))
      || state.records.some(record => record.type === 'actor-exchange' && record.passageId === reaction.passageId)) return;
  const { actorId, actorName, passageId, minute, speech } = reaction;
  // Store speech separately. It does not alter world facts, an observation,
  // the canonical action, or the clerk's utterance history.
  state.records.push({ type: 'actor-exchange', reaction: true, actorId, passageId, minute, reply: speech });
  return actorName + ' says, “' + speech + '”';
}
