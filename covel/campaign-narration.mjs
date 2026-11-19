import { setTimeout as delay } from 'node:timers/promises';
import { campaignNarrationDirection, dramaticaDirection } from './editorial-direction.mjs';

const parts = {
  answer: 'Carry the particular effect of this action forward in the first sentence, without repeating the resolution.',
  practice: 'Use a particular line, mark, word, or item of work made available in this turn to show why it matters.',
  stakes: 'Show who bears the cost of leaving this as it stands. Use a conditional where the outcome is still open.',
  opening: 'End on one named source, practical choice, or piece of work available in the scene. Leave that decision open.',
};
const intentions = {
  verify: 'Follow the printed result. When examination is only offered or arranged, explore what the clerk could ask or compare when the material is available.',
  press: 'Answer the demand directly. Keep the distinction between a question, a refusal, and a ruling.',
  help: 'Make clear whose work the offer affects and what they actually took on, if anything.',
  defer: 'Let the other person carry their part of the work. Do not interpret restraint as a verdict or a refusal.',
  'actor-exchange': 'Make the effect of the spoken answer felt immediately. Leave all new speech to the character.',
  'campaign-opened': 'Enter the new matter at its first real tension using only what became public in this case.',
};
const pendingParts = {
  answer: 'Follow what the request changed about who can answer or how the work may proceed. Keep the object out of sight until it is shown.',
  practice: 'Make the existing request or offer concrete through the earlier public account. Leave the unseen object and its marks undescribed.',
  stakes: 'Use a concern already stated in the opening of this case. Keep alternatives open and name no new cost or liability.',
  opening: 'Finish on the practical question the named witness can answer when the evidence is ready. Do not answer it yet.',
};
const dramaticParts = {
  answer: 'Begin with the effect of this action made immediate for the clerk. Follow one person or object already involved.',
  stakes: 'Let a grounded pressure or disagreement shape this beat. Move beyond the result already printed.',
  opening: 'End on one live consequence, question, or obligation. Do not repeat the menu or direct the clerk to act.',
};
const dramaticFocus = {
  setup: 'Stage the pressure in the attributed opening and the disagreement already admitted. Save any unseen detail for the source that can show it.',
  reveal: 'Keep the immediate difference between seeing the source and hearing an attributed account. State what the evidence narrows and leave the rest open.',
  decision: 'Bring the actual disposition forward into what its named actor can now do. A report still carries the name and limits of its source.',
  consequence: 'Describe the supplied piece of work and locate the remaining responsibility. Do not use the next case as scenery in this one.',
  observe: 'The clerk looks. Draw attention to a question or relationship already in view. Add no sighting, material detail, movement, or inspection.',
  'actor-exchange': 'Follow the practical effect of the answer that was spoken. Add no words, gesture, or terms the speaker did not give.',
};
const wordCount = text => text.split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
export const campaignWordCount = paragraphs => paragraphs.reduce((sum, paragraph) => sum + wordCount(paragraph), 0);

const instructions = `Continue The Bread Ledger for the player, who is the clerk in Malory's London. The engine has already printed the result. Begin after it and explore one practical consequence of the action the player chose. Write in second-person present tense, using the working vocabulary of the people here and varying sentence length.

Use printed and newEvidence for what changes on this turn. earlierEvidence and caseHistory only supply context. A request to inspect a source leaves it pending until the engine makes it available. Keep reports attributed, possibilities conditional, and firsthand evidence limited to the specific detail shown. A person's name as the source of a report carries only that meaning. When the evidence stays the same, move the scene through the cost, choice, or question already raised by the action.

Do not add any prop, person, event, movement, gesture, thought, speech, commitment, or player action beyond the supplied material. Do not assign the clerk feelings or words. Character speech is supplied separately. Add no quotation or indirect speech and leave the printed result in place without a recap. Give each required field one substantial paragraph with a different purpose and around the requested word count. Return the paragraph text in the specified fields.`;

function asSchema(keys) {
  return {
    type: 'object', properties: Object.fromEntries(keys.map(key => [key, { type: 'string' }])),
    required: keys, additionalProperties: false,
  };
}

export async function narrateCampaign({ complete, signal, noteStall, playerText, scene, passages, recent, newObservations, earlierEvidence = [], resolvedIntent, closingBeat, reactionBudget = 0, dramatica = false }) {
  const authoritative = passages.flatMap(passage => passage.paragraphs);
  const close = authoritative.length > 1 && authoritative.at(-1) === closingBeat ? [closingBeat] : [];
  const resolved = close.length ? authoritative.slice(0, -1) : authoritative;
  const finish = narrative => [...resolved, ...narrative, ...close];
  const canonicalWords = campaignWordCount(authoritative);
  const floor = 200 - canonicalWords;
  if (floor <= 0) return authoritative;
  const ceiling = floor + 100 - reactionBudget;
  const target = Math.min(campaignNarrationDirection.targetWords, 300 - reactionBudget - 23) - canonicalWords;
  const keys = dramatica ? (floor < 105 ? ['answer', 'opening'] : ['answer', 'stakes', 'opening'])
    : floor >= 140 && !reactionBudget ? Object.keys(parts)
    : floor >= 80 ? ['answer', 'stakes', 'opening'] : ['answer', 'opening'];
  const evidence = observations => observations.map(({ title, text, source, status }) => ({ title, text, source, status }));
  const context = {
    campaignNarration: true, playerText, scene, resolvedIntent, printed: resolved,
    caseHistory: recent.map(({ heading, paragraphs }) => ({ heading, published: paragraphs.join(' ').slice(0, 420) })),
    newEvidence: evidence(newObservations), earlierEvidence: evidence(earlierEvidence),
    ...(dramatica && { perception: {
      visibleNow: evidence(newObservations.filter(item => item.status === 'firsthand')),
      reportedNow: evidence(newObservations.filter(item => item.status === 'reported')),
    } }),
    parts: Object.fromEntries(keys.map(key => [key, dramatica ? dramaticParts[key] : resolvedIntent?.phase === 0 ? pendingParts[key]
      : key === 'answer' ? intentions[resolvedIntent?.stance ?? resolvedIntent?.kind] ?? parts.answer : parts[key]])),
    wordsPerParagraph: Math.ceil(target / keys.length) + 8, targetWords: target,
  };
  const focus = resolvedIntent?.beat?.kind ?? resolvedIntent?.kind;
  const direction = dramatica ? [dramaticaDirection.scene, dramaticaDirection.prose, dramaticFocus[focus],
    'Use perception.visibleNow for newly visible particulars and keep perception.reportedNow as attributed speech or writing. If neither projection supplies a detail, use the scene’s established immediate question. A choice or an earlier case is no evidence of something onstage.'
  ].filter(Boolean).join(' ') : campaignNarrationDirection.instruction;
  const prompt = instructions + '\n\n' + direction;
  const alreadyPrinted = new Set(authoritative.map(text => text.trim()));
  let best;
  let lastError;
  const acceptable = size => size >= floor && size <= ceiling;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    try {
      const addOne = best && best.size < floor;
      const fields = addOne ? ['bridge'] : keys;
      const result = await complete({
        name: 'harbinger_campaign_narration',
        instructions: addOne ? prompt + '\n\nFill in one distinct connective paragraph before the ending. Use only the case evidence and the printed text as authority.' : prompt,
        context: addOne ? { ...context, parts: { bridge: 'Use a different grounded present detail. Avoid repeating the already drafted topics.' },
          wordsPerParagraph: floor - best.size + 22, targetWords: floor - best.size + 22,
          draftedTopics: best.paragraphs.map(p => p.slice(0, 100)) } : context,
        schema: asSchema(fields), maxOutputTokens: addOne ? 240 : 500,
      });
      const draft = fields.map(key => result?.[key]);
      if (draft.some(text => typeof text !== 'string' || !text.trim())) continue;
      const seen = new Set([...alreadyPrinted, ...(addOne ? best.paragraphs.map(text => text.trim()) : [])]);
      const fresh = draft.filter(text => {
        const paragraph = text.trim();
        if (seen.has(paragraph)) return false;
        seen.add(paragraph);
        return true;
      });
      if (!fresh.length) continue;
      let paragraphs = addOne ? [...best.paragraphs.slice(0, -1), ...fresh, best.paragraphs.at(-1)] : fresh;
      let size = campaignWordCount(paragraphs);
      if (size > ceiling && paragraphs.length > 2) {
        const shorter = paragraphs.filter((_, index) => index !== 1);
        if (acceptable(campaignWordCount(shorter))) paragraphs = shorter;
        size = campaignWordCount(paragraphs);
      }
      if (acceptable(size)) return finish(paragraphs);
      if (!best || Math.abs(size - target) < Math.abs(best.size - target)) best = { paragraphs, size };
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
      if (error.name === 'TimeoutError' || error.code === 'TIMEOUT') noteStall?.('campaign-narration');
      if (attempt < 2) await delay(300 * (attempt + 1), undefined, { signal });
    }
  }
  if (best) return finish(best.paragraphs);
  throw new Error('The campaign narrator returned no passage.', { cause: lastError });
}
