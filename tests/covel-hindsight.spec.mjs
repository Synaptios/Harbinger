import { expect, test } from '@playwright/test';
import { createHindsight } from '../covel/hindsight.mjs';

test('ranks authorized evidence by document reference and keeps Harbinger’s wording', async () => {
  const evidence = [
    { id: 'first', text: 'Alice saw flour on the sill.', source: 'Alice' },
    { id: 'second', text: 'Martin lent Alice a dry cloth.', source: 'Martin' },
    { id: 'third', text: 'The window was open.', source: 'Alice' },
  ];
  const requests = [];
  const retained = Promise.withResolvers();
  const memory = createHindsight({
    baseUrl: 'http://hindsight.test', apiKey: 'local-fixture-key',
    fetch: async (url, options) => {
      const pathname = new URL(url).pathname;
      const body = JSON.parse(options.body);
      requests.push({ pathname, body, authorization: options.headers.Authorization });
      if (pathname.endsWith('/memories')) {
        retained.resolve(body.items);
        return Response.json({ success: true });
      }
      const items = await retained.promise;
      return Response.json({ results: [
        { document_id: 'another-speaker-private-memory', text: 'Unapproved private material.' },
        { document_id: items[1].document_id, text: 'Hindsight’s incorrect paraphrase.' },
        { document_id: items[1].document_id, text: 'Duplicate paraphrase.' },
      ] });
    },
  });

  const result = await memory.recall({ sessionId: 'save-a', incarnation: 'one', actorId: 'alice', query: 'What did Martin lend me?', evidence });

  expect(result).toEqual([evidence[1], evidence[0], evidence[2]]);
  const retain = requests.find(({ pathname }) => pathname.endsWith('/memories'));
  const recall = requests.find(({ pathname }) => pathname.endsWith('/memories/recall'));
  expect(retain.pathname).toMatch(/^\/v1\/default\/banks\/harbinger-[a-f0-9]+\/memories$/u);
  expect(recall.pathname).toBe(`${retain.pathname}/recall`);
  expect(retain.authorization).toBe('Bearer local-fixture-key');
  expect(recall.authorization).toBe(retain.authorization);
  expect(retain.body.async).toBe(true);
  expect(retain.body.items.map(item => item.content)).toEqual(evidence.map(item => item.text));
  expect(recall.body.query).toBe('What did Martin lend me?');
});

test('separates save, incarnation, and actor banks and rejects superseded evidence', async () => {
  const original = [{ id: '1', text: 'The door was sealed.' }, { id: '2', text: 'The floor is wet.' }];
  const revised = [original[1], { id: '1', text: 'The door is open.' }];
  const deliveries = [];
  const searches = [];
  const memory = createHindsight({ baseUrl: 'http://hindsight.test', apiKey: '', fetch: async (url, options) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/memories')) {
      deliveries.push({ pathname, body: JSON.parse(options.body) });
      return Response.json({ success: true });
    }
    searches.push(pathname);
    const firstDocument = deliveries[0].body.items[0].document_id;
    return Response.json({ results: [{ document_id: firstDocument, text: 'The door was sealed.' }] });
  } });
  const scope = { sessionId: 'save-a', incarnation: 'first', actorId: 'alice', query: 'Is the door sealed?' };

  expect(await memory.recall({ ...scope, evidence: original })).toEqual(original);
  expect(await memory.recall({ ...scope, evidence: revised })).toEqual(revised);
  expect(await memory.recall({ ...scope, sessionId: 'save-b', evidence: [...original].reverse() })).toEqual([...original].reverse());
  expect(await memory.recall({ ...scope, incarnation: 'replacement', evidence: [...original].reverse() })).toEqual([...original].reverse());
  expect(await memory.recall({ ...scope, actorId: 'martin', evidence: [...original].reverse() })).toEqual([...original].reverse());

  expect(searches[1]).toBe(searches[0]);
  expect(new Set(searches).size).toBe(4);
  expect(deliveries[1].body.items.map(item => item.content)).toEqual(['The door is open.']);
  expect(deliveries[1].body.items[0].document_id).not.toBe(deliveries[0].body.items[0].document_id);
  expect(new Set(deliveries.map(delivery => delivery.body.operation_id)).size).toBe(5);
});

test('falls back within the recall deadline while retaining off the turn path', async () => {
  const evidence = [{ id: '1', text: 'The apprentice used the old stair.' }];
  const retain = Promise.withResolvers();
  const signals = {};
  const scope = { sessionId: 'save-a', actorId: 'alice', query: 'How did they leave?', evidence };
  const memory = createHindsight({ baseUrl: 'http://hindsight.test', apiKey: '', timeoutMs: 40, fetch: async (url, { signal }) => {
    if (url.endsWith('/memories')) {
      signals.retain = signal;
      return retain.promise;
    }
    signals.recall = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });

  try {
    expect(await memory.recall(scope)).toBe(evidence);
    expect(signals.recall.aborted).toBe(true);
    expect(signals.retain.aborted).toBe(false);
  } finally {
    retain.resolve(Response.json({ success: true }));
  }

  const disabled = createHindsight({ baseUrl: '', fetch: () => { throw new Error('Unexpected memory request'); } });
  expect(await disabled.recall(scope)).toBe(evidence);
});
