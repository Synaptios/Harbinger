export const pacingDirection = {
  targetWords: 208,
  leadWithResolution: true,
  closeOnDecision: true,
  closeOnFocus: true,
  relevanceWeight: 1,
  topicRepetitionPenalty: 3,
};

export const dialogueDirection = {
  conversation: 'Answer first in the speaker’s working language. Let their trust shape how much they offer. If the clerk challenges the account, take a position in plain language and specify what would settle it for this speaker. Keep facts attached to the people who saw or reported them.',
  record: 'Favor the option that gives the direct answer and leaves the clerk with one useful step. Where several options do that, favor the one that sounds like a person taking a position in their own trade.',
  threat: 'The clerk made a spoken threat. In the first sentence, say how this character received the words or wants the conversation to proceed. Use only the supplied evidence for any answer. Do not describe the clerk’s posture, imply the threat was carried out, introduce backstory, or make new arrangements.',
  recordReaction: 'The clerk made a spoken threat. Keep reply as the ID of the known answer. Add a reaction field with one short sentence the character could say about hearing those words, or null. Use it for an immediate feeling or conversational boundary. Keep all facts in the selected answer. Leave posture, backstory, and arrangements out of the reaction.',
};

export const campaignNarrationDirection = {
  targetWords: 238,
  instruction: 'Let a specific cost, disagreement, or bit of work carry the feeling. An irregular entry by itself establishes no fraud, theft, guilt, missing stock, or failed obligation. A reserved correction can remain unused. Give the last sentence to the particular work or choice the action leaves available. Avoid endings about waiting, silence, or the record merely staying open.',
};

// Scene construction adapted from Dramatica Flow's Architect and Writer stages.
export const dramaticaDirection = {
  scene: 'Open the added prose on a visible response to what the clerk just did. Carry one cause through the next act to its consequence. Make clear who can do or answer something now. End on the situation as it stands or on one live choice the scene has made possible. Use the supplied beats as authority and leave the choice to the clerk.',
  prose: 'Write close second-person present tense. Use plain words and the physical work already in the scene. Let a short sentence land when something changes. Change paragraph length with the pressure in the room. Keep the prose in the moment and leave administrative commentary to the journal.',
  speech: 'Let the speaker’s position in this encounter shape their plainspoken reply. Keep the concrete object and the degree of proof exact. Let the rhythm and choice of verbs carry the voice. The speaker’s trade supplies words. It supplies no new facts.',
};

const dramaticaVoices = {
  alice: 'Alice makes concern practical. Use direct verbs and let warmth or impatience show in what she can take responsibility for.',
  martin: 'Martin puts the source first. Give him measured sentences and exact distinctions between the person who saw a thing and the person who brought word of it.',
  'market-baker': 'The market baker is particular about what the work will take. Use oven, heat, board, or tray only when the supplied evidence names it.',
  'market-carter': 'The market carter gets to the distinguishing mark or line without ceremony. Speak tersely and leave guesses with whoever made them.',
  'river-carter': 'The river carter is terse about what reached which hand. Say plainly where their knowledge ends.',
  'guild-runner': 'The guild runner relays the exact reach of the message. Use clipped clauses and distinguish a witnessed handoff from the paper’s claim.',
};

export function dramaticaSpeechFor(actorId) {
  return [dramaticaDirection.speech, dramaticaVoices[actorId]].filter(Boolean).join(' ');
}
