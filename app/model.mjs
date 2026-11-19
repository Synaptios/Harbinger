const instructions = {
  interpret: 'Interpret only the protagonist’s requested actions in order. Return an object with an intents array. Allowed intents: {"type":"choice","choice":"exact visible choice"}, {"type":"observe"}, {"type":"take-ledger"}, {"type":"speak","words":"the player’s words"}, or {"type":"unclear"}. Never determine the outcome, change world state, or supply invented dialogue for the protagonist.',
};

export function createModel({ url, name, key, reasoningEffort, timeoutMs = 15000 }) {
  if (!url || !name) throw new Error('Set both HARBINGER_MODEL_URL and HARBINGER_MODEL_NAME.');
  const endpoint = new URL(url);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('The model endpoint must use HTTP or HTTPS.');
  return {
    async complete({ operation, context, instruction = instructions[operation] }) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (key) headers.Authorization = 'Bearer ' + key;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          redirect: 'error',
          body: JSON.stringify({
            model: name,
            ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: instruction + '\nReturn a JSON object.' },
              { role: 'user', content: JSON.stringify(context) },
            ],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error('Provider rejected the request.');
        const envelope = await response.json();
        const result = JSON.parse(envelope.choices[0].message.content);
        return operation === 'interpret' ? result.intents : result;
      } catch {
        throw Object.assign(new Error('The story model could not complete this request. You can retry the turn.'), { status: 502 });
      }
    },
  };
}

export function providerFromEnvironment(env = process.env) {
  const {
    HARBINGER_MODEL_URL: url, HARBINGER_MODEL_NAME: name,
    HARBINGER_MODEL_KEY: key, HARBINGER_REASONING_EFFORT: reasoningEffort,
  } = env;
  return url || name ? { url, name, key, reasoningEffort } : undefined;
}
