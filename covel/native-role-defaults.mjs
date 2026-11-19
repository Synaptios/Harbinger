export const additionalTextSlots = ['character', 'state'];

export function fixedDirectionSlots(connections, keys) {
  const out = {};
  const openrouter = keys.OPENROUTER_API_KEY && connections.openrouter;
  const inworld = keys.INWORLD_API_KEY && connections.inworld;
  if (openrouter) out['covel.triggers'] = {
    provider: 'openrouter', baseUrl: openrouter.baseUrl, protocol: 'openrouter-decisions-v1', model: 'typesafe/jev-1.13',
  };
  const pacing = inworld || openrouter;
  if (pacing) out['covel.pacing-director'] = {
    provider: inworld ? 'inworld' : 'openrouter', baseUrl: pacing.baseUrl, protocol: 'openai-chat-v1',
    model: inworld ? 'inworld/models/gemma-4-31b-it' : 'google/gemma-4-31b-it',
  };
  const text = openrouter || inworld;
  if (text) {
    const connection = { provider: openrouter ? 'openrouter' : 'inworld', baseUrl: text.baseUrl, protocol: 'openai-chat-v1' };
    out['covel.staging'] = { ...connection, model: openrouter ? 'google/gemma-4-31b-it' : 'inworld/models/gemma-4-31b-it' };
    out['covel.state-complex'] = { ...connection, model: openrouter ? 'google/gemini-3-flash-preview' : 'google-ai-studio/gemini-3-flash-preview' };
  }
  return out;
}
