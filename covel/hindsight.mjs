import { createHash } from 'node:crypto';

const maxRememberedDocuments = 4096;

function digest(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function operationId(documentIds) {
  const hash = digest([...documentIds].sort());
  // Hindsight accepts a UUID for safely retrying an asynchronous retain.
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function bankEndpoint(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) {
      return `${url.href.replace(/\/+$/u, '')}/v1/default/banks`;
    }
  } catch {
    // An absent or unusable URL leaves authoritative local recall in place.
  }
}

export function createHindsight({
  baseUrl = process.env.HINDSIGHT_URL,
  apiKey = process.env.HINDSIGHT_API_KEY,
  timeoutMs = 900,
  fetch: request = globalThis.fetch,
} = {}) {
  const endpoint = bankEndpoint(baseUrl);
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  const submitted = new Set();

  async function post(url, body, timeout, signal) {
    const limit = AbortSignal.timeout(timeout);
    const response = await request(url, {
      method: 'POST', headers, redirect: 'error', body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, limit]) : limit,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return;
    }
    return response.json();
  }

  async function retain(url, records) {
    const documentIds = [...records.keys()].filter(id => !submitted.has(id));
    if (!documentIds.length) return;
    for (const id of documentIds) submitted.add(id);

    try {
      const response = await post(url, {
        async: true,
        operation_id: operationId(documentIds),
        items: documentIds.map(id => ({
          document_id: id,
          content: records.get(id).text,
          timestamp: 'unset',
        })),
      }, 5000);
      if (response?.success) return;
    } catch {
      // The same document IDs can safely be submitted again on a later turn.
    } finally {
      while (submitted.size > maxRememberedDocuments) submitted.delete(submitted.values().next().value);
    }
    for (const id of documentIds) submitted.delete(id);
  }

  return {
    async recall({ sessionId, incarnation, actorId, query, evidence, signal }) {
      if (!endpoint || !sessionId || !actorId || !evidence.length || signal?.aborted) return evidence;
      const bank = `harbinger-${digest([sessionId, incarnation ?? null, actorId]).slice(0, 48)}`;
      const url = `${endpoint}/${bank}/memories`;
      const records = new Map();
      for (const record of evidence) {
        if (typeof record?.id !== 'string' || typeof record.text !== 'string' || !record.text.trim()) continue;
        // A former version can remain in Hindsight, but only the current record's reference can match.
        const id = `evidence-${digest([bank, record.id, record.text])}`;
        records.set(id, record);
      }
      if (!records.size) return evidence;
      void retain(url, records);

      const question = typeof query === 'string' && query.trim().slice(0, 800);
      if (!question) return evidence;
      try {
        const response = await post(`${url}/recall`, {
          query: question, budget: 'low', max_tokens: 512, types: ['world', 'experience'],
        }, timeoutMs, signal);
        if (!Array.isArray(response?.results)) return evidence;
        const ranked = new Set();
        for (const result of response.results) {
          const record = records.get(result?.document_id);
          if (record) ranked.add(record);
        }
        return [...ranked, ...evidence.filter(record => !ranked.has(record))];
      } catch {
        return evidence;
      }
    },
  };
}
