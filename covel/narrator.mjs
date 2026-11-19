export async function requestStoryObject(provider, { name, instructions, context, schema }) {
  provider.signal?.throwIfAborted();
  const endpoint = new URL(provider.url);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new TypeError('Invalid model endpoint');
  const headers = { 'Content-Type': 'application/json' };
  if (provider.key) headers.Authorization = `Bearer ${provider.key}`;
  const responses = endpoint.pathname.endsWith('/responses');
  const openRouter = provider.id === 'openrouter';
  const input = JSON.stringify(context);
  const payload = responses ? {
    model: provider.name,
    ...(provider.reasoningEffort && { reasoning: { effort: provider.reasoningEffort } }),
    instructions,
    input,
    text: { format: { type: 'json_schema', name, strict: true, schema } },
    store: false,
  } : {
    model: provider.name,
    ...(provider.reasoningEffort && (openRouter
      ? { reasoning: { effort: provider.reasoningEffort } }
      : { reasoning_effort: provider.reasoningEffort })),
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: input },
    ],
    response_format: { type: 'json_object' },
  };
  const timeout = AbortSignal.timeout(provider.timeoutMs ?? 90_000);
  const signal = provider.signal ? AbortSignal.any([provider.signal, timeout]) : timeout;
  const response = await fetch(endpoint, {
    method: 'POST', headers, body: JSON.stringify(payload), redirect: 'error',
    signal,
  });
  if (!response.ok) throw new Error('Provider rejected the story request');
  const envelope = await response.json();
  const output = responses ? envelope.output
    .flatMap(item => item.type === 'message' ? item.content : [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text).join('') : envelope.choices[0].message.content;
  return JSON.parse(output);
}
